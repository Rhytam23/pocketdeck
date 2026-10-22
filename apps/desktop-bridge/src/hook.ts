#!/usr/bin/env node
/**
 * Claude Code hook command. Must never block or break the agent:
 * any failure (bridge down, bad input, timeout) exits 0 with no output, so Claude Code carries on
 * and, for permission requests, asks in the terminal as usual.
 */
import { pathToFileURL } from "node:url";
import { hookReply } from "./adapters/claude.js";
import { requestIpc } from "./ipc.js";
import { socketPath } from "./paths.js";

const APPROVAL_WAIT_MS = 125_000;
const FIRE_AND_FORGET_MS = 1_500;

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export async function runHook(stdin: string, path = socketPath()): Promise<string> {
  let input: { hook_event_name?: string };
  try {
    input = JSON.parse(stdin);
  } catch {
    return "";
  }
  const isPermission = input.hook_event_name === "PermissionRequest";
  try {
    const reply = (await requestIpc(path, { hook: input }, {
      wait: isPermission,
      timeoutMs: isPermission ? APPROVAL_WAIT_MS : FIRE_AND_FORGET_MS,
    })) as { decision?: "allow" | "deny" | "none"; message?: string } | null;
    if (!isPermission || !reply?.decision) return "";
    return hookReply(reply.decision, reply.message);
  } catch {
    return "";
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await runHook(await readStdin());
  if (out) process.stdout.write(out);
  process.exit(0);
}
