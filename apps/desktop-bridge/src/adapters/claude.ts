import { readFile } from "node:fs/promises";
import { canonicalJson } from "@pocketdeck/protocol";
import type { AgentAdapter, Normalized, NormalizedEvent } from "./types.js";

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

function summarize(tool: string, input: Json): string {
  const target = str(input.file_path) ?? str(input.path) ?? str(input.pattern) ?? str(input.url);
  if (tool === "Bash") return `Bash: ${(str(input.command) ?? "").split("\n")[0]?.slice(0, 120) ?? ""}`;
  return target ? `${tool} ${target}` : tool;
}

/** Full command text the approval hash covers. Bash is the raw command; other tools the canonical input. */
export function permissionCommand(tool: string, input: unknown): string {
  if (tool === "Bash" && isObj(input) && typeof input.command === "string") return input.command;
  return canonicalJson(input ?? {});
}

function lines(prefix: string, text: string): string[] {
  return text.split("\n").map((l) => prefix + l);
}

/** Small readable diff from an Edit/Write/MultiEdit tool input. Not a git diff, but enough to review. */
export function diffFromTool(tool: string, input: Json): string | undefined {
  const file = str(input.file_path);
  if (!file) return undefined;
  const hunk = (oldS: string, newS: string) => [...lines("-", oldS), ...lines("+", newS)].join("\n");
  if (tool === "Edit") {
    return `--- ${file}\n+++ ${file}\n${hunk(str(input.old_string) ?? "", str(input.new_string) ?? "")}`;
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const parts = input.edits.filter(isObj).map((e) => hunk(str(e.old_string) ?? "", str(e.new_string) ?? ""));
    return `--- ${file}\n+++ ${file}\n${parts.join("\n@@\n")}`;
  }
  if (tool === "Write") return `+++ ${file}\n${lines("+", str(input.content) ?? "").join("\n")}`;
  return undefined;
}

export const claudeAdapter: AgentAdapter = {
  name: "claude-code",
  normalize(raw) {
    if (!isObj(raw)) return null;
    const sessionId = str(raw.session_id);
    const hook = str(raw.hook_event_name);
    if (!sessionId || !hook) return null;
    const out: Normalized = {
      agent: "claude-code",
      sessionId,
      cwd: str(raw.cwd) ?? "",
      events: [],
      transcriptPath: str(raw.transcript_path),
    };
    const tool = str(raw.tool_name) ?? "";
    const input = isObj(raw.tool_input) ? raw.tool_input : {};
    const ev = (e: NormalizedEvent) => out.events.push(e);

    switch (hook) {
      case "SessionStart":
        ev({ kind: "session.start", summary: `Session started (${str(raw.source) ?? "startup"})` });
        out.stateAfter = "idle";
        break;
      case "UserPromptSubmit":
        ev({ kind: "prompt", text: str(raw.prompt) ?? "" });
        out.stateAfter = "running";
        break;
      case "PreToolUse":
        ev({ kind: "tool.pre", tool, summary: summarize(tool, input) });
        out.stateAfter = "running";
        break;
      case "PostToolUse": {
        ev({ kind: "tool.post", tool, summary: summarize(tool, input) });
        const diff = diffFromTool(tool, input);
        if (diff) ev({ kind: "diff", tool, summary: summarize(tool, input), diff });
        out.stateAfter = "running";
        break;
      }
      case "PermissionRequest":
        out.permission = { tool, command: permissionCommand(tool, input) };
        ev({ kind: "approval.request", tool, summary: summarize(tool, input) });
        out.stateAfter = "needs_approval";
        break;
      case "Notification":
        ev({ kind: "question", text: str(raw.message) ?? "" });
        break;
      case "Stop":
        ev({ kind: "stop" });
        out.stateAfter = "idle";
        break;
      case "SessionEnd":
        ev({ kind: "stop", summary: `Session ended (${str(raw.reason) ?? "other"})` });
        out.stateAfter = "ended";
        break;
      default:
        return null;
    }
    return out;
  },
};

/** Last assistant text in a Claude Code transcript (JSONL). Tolerant of format drift: returns undefined on any surprise. */
export async function lastAssistantText(transcriptPath: string): Promise<string | undefined> {
  try {
    const lines = (await readFile(transcriptPath, "utf8")).trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i] as string) as Json;
      if (entry.type !== "assistant" || !isObj(entry.message)) continue;
      const content = entry.message.content;
      const text = Array.isArray(content)
        ? content.filter((b): b is Json => isObj(b) && b.type === "text").map((b) => str(b.text) ?? "").join("\n")
        : str(content);
      if (text && text.trim()) return text.slice(0, 20_000);
    }
  } catch {
    /* unreadable transcript is fine */
  }
  return undefined;
}

export function hookReply(decision: "allow" | "deny" | "none", message?: string): string {
  if (decision === "none") return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: decision === "allow" ? { behavior: "allow" } : { behavior: "deny", message: message ?? "Denied from PocketDeck" },
    },
  });
}
