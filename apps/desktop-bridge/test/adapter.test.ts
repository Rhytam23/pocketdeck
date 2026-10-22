import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeAdapter, diffFromTool, hookReply, lastAssistantText, permissionCommand } from "../src/adapters/claude.js";

const base = { session_id: "s1", cwd: "/work", transcript_path: "/t.jsonl" };

describe("claude adapter", () => {
  it("maps hook events onto the shared vocabulary", () => {
    const n = (e: object) => claudeAdapter.normalize({ ...base, ...e });
    expect(n({ hook_event_name: "SessionStart", source: "resume" })?.events[0]?.kind).toBe("session.start");
    expect(n({ hook_event_name: "UserPromptSubmit", prompt: "fix it" })).toMatchObject({ stateAfter: "running", events: [{ kind: "prompt", text: "fix it" }] });
    expect(n({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls\nmore" } })?.events[0]).toMatchObject({ kind: "tool.pre", summary: "Bash: ls" });
    expect(n({ hook_event_name: "Notification", message: "Claude needs input" })?.events[0]).toMatchObject({ kind: "question", text: "Claude needs input" });
    expect(n({ hook_event_name: "Stop" })).toMatchObject({ stateAfter: "idle", events: [{ kind: "stop" }] });
    expect(n({ hook_event_name: "SessionEnd", reason: "clear" })?.stateAfter).toBe("ended");
  });
  it("produces a diff event after file edits", () => {
    const n = claudeAdapter.normalize({
      ...base, hook_event_name: "PostToolUse", tool_name: "Edit",
      tool_input: { file_path: "/work/a.ts", old_string: "a", new_string: "b\nc" },
    });
    expect(n?.events.map((e) => e.kind)).toEqual(["tool.post", "diff"]);
    expect(n?.events[1]?.diff).toBe("--- /work/a.ts\n+++ /work/a.ts\n-a\n+b\n+c");
    expect(diffFromTool("Bash", { command: "x" })).toBeUndefined();
    expect(diffFromTool("Write", { file_path: "/f", content: "x" })).toBe("+++ /f\n+x");
  });
  it("extracts the full command for permission requests", () => {
    const n = claudeAdapter.normalize({ ...base, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf x" } });
    expect(n?.permission).toEqual({ tool: "Bash", command: "rm -rf x" });
    expect(n?.stateAfter).toBe("needs_approval");
    expect(permissionCommand("Write", { b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("ignores garbage and unknown events", () => {
    expect(claudeAdapter.normalize(null)).toBeNull();
    expect(claudeAdapter.normalize({ hook_event_name: "Stop" })).toBeNull();
    expect(claudeAdapter.normalize({ ...base, hook_event_name: "PreCompact" })).toBeNull();
  });
  it("builds hook output only for real decisions", () => {
    expect(hookReply("none")).toBe("");
    expect(JSON.parse(hookReply("allow")).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
    expect(JSON.parse(hookReply("deny")).hookSpecificOutput.decision.behavior).toBe("deny");
  });
  it("reads the last assistant text from a transcript and tolerates bad files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-"));
    const f = join(dir, "t.jsonl");
    await writeFile(f, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "old" }] } }),
      JSON.stringify({ type: "user", message: { content: "q" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "all done" }] } }),
    ].join("\n"));
    expect(await lastAssistantText(f)).toBe("all done");
    expect(await lastAssistantText(join(dir, "missing"))).toBeUndefined();
    await writeFile(f, "not json");
    expect(await lastAssistantText(f)).toBeUndefined();
  });
});
