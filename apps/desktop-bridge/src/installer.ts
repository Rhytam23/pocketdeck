import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CLAUDE_HOOK_EVENTS } from "./adapters/claude.js";
import { unifiedDiff } from "./diff.js";

/** Marker that identifies hook entries owned by PocketDeck, so we never touch anyone else's. */
export const MARKER = "--pocketdeck-hook";
const APPROVAL_TIMEOUT_S = 130;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function hookCommand(hookScript: string, node = "node"): string {
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
  return `${q(node)} ${q(hookScript)} ${MARKER}`;
}

const isOurs = (entry: unknown): boolean =>
  isObj(entry) && Array.isArray(entry.hooks) && entry.hooks.some((h) => isObj(h) && typeof h.command === "string" && h.command.includes(MARKER));

/** Returns a new settings object with PocketDeck hooks added (or removed). Everything else is preserved. */
export function mergeHooks(settings: Json, command: string | null): Json {
  const hooks: Json = isObj(settings.hooks) ? { ...settings.hooks } : {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const others = existing.filter((e) => !isOurs(e));
    const ours =
      command === null
        ? []
        : [
            {
              matcher: "*",
              hooks: [{ type: "command", command, timeout: event === "PermissionRequest" ? APPROVAL_TIMEOUT_S : 5 }],
            },
          ];
    const merged = [...others, ...ours];
    if (merged.length) hooks[event] = merged;
    else delete hooks[event];
  }
  const out: Json = { ...settings };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

export function backupName(path: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${path}.pocketdeck-backup-${stamp}`;
}

export interface InstallPlan {
  path: string;
  before: string;
  after: string;
  diff: string;
  existed: boolean;
}

export async function planInstall(path: string, command: string | null): Promise<InstallPlan> {
  let before = "";
  let existed = true;
  try {
    before = await readFile(path, "utf8");
  } catch {
    existed = false;
  }
  let settings: Json = {};
  if (before.trim()) {
    try {
      const parsed: unknown = JSON.parse(before);
      if (!isObj(parsed)) throw new Error("not an object");
      settings = parsed;
    } catch (e) {
      throw new Error(`${path} is not valid JSON (${(e as Error).message}). Refusing to touch it; fix it first.`);
    }
  }
  const after = JSON.stringify(mergeHooks(settings, command), null, 2) + "\n";
  const normalizedBefore = before.trim() ? JSON.stringify(JSON.parse(before), null, 2) + "\n" : "";
  return { path, before, after, existed, diff: unifiedDiff(normalizedBefore, after, path) };
}

export interface ApplyOptions {
  now?: Date;
}

/** Writes the plan. Backs up first, writes atomically, keeps the original file mode. Returns the backup path. */
export async function applyInstall(plan: InstallPlan, opts: ApplyOptions = {}): Promise<string | null> {
  await mkdir(dirname(plan.path), { recursive: true });
  let backup: string | null = null;
  let mode = 0o600;
  if (plan.existed) {
    backup = backupName(plan.path, opts.now ?? new Date());
    await copyFile(plan.path, backup);
    mode = (await stat(plan.path)).mode & 0o777;
  }
  const tmp = `${plan.path}.pocketdeck-tmp-${process.pid}`;
  await writeFile(tmp, plan.after, { mode });
  await rename(tmp, plan.path);
  return backup;
}
