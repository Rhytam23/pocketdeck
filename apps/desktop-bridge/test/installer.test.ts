import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/diff.js";
import { MARKER, applyInstall, backupName, hookCommand, mergeHooks, planInstall } from "../src/installer.js";

const cmd = hookCommand("/opt/pd/hook.js", "/usr/bin/node");
const theirs = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] }, model: "opus" };

describe("mergeHooks", () => {
  it("adds our hooks and preserves everything else", () => {
    const out = mergeHooks(structuredClone(theirs), cmd) as typeof theirs & { hooks: Record<string, unknown[]> };
    expect(out.model).toBe("opus");
    expect(out.hooks.PreToolUse).toHaveLength(2);
    expect(out.hooks.PreToolUse?.[0]).toEqual(theirs.hooks.PreToolUse[0]);
    expect(Object.keys(out.hooks)).toContain("PermissionRequest");
    expect(JSON.stringify(out)).toContain(MARKER);
  });
  it("is idempotent and removable", () => {
    const once = mergeHooks(structuredClone(theirs), cmd);
    expect(mergeHooks(structuredClone(once), cmd)).toEqual(once);
    expect(mergeHooks(structuredClone(once), null)).toEqual(theirs);
    expect(mergeHooks({}, cmd) && mergeHooks(mergeHooks({}, cmd), null)).toEqual({});
  });
  it("quotes paths with spaces", () => {
    expect(hookCommand("/a b/hook.js", "node")).toBe('"node" "/a b/hook.js" ' + MARKER);
  });
});

describe("install plan and apply", () => {
  it("shows a diff, backs up with a dated name, writes atomically and keeps file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify(theirs, null, 2), { mode: 0o640 });
    const plan = await planInstall(path, cmd);
    expect(plan.diff).toContain("+");
    expect(plan.diff).toContain("PermissionRequest");
    expect(await readFile(path, "utf8")).toBe(JSON.stringify(theirs, null, 2)); // planning never writes
    const backup = await applyInstall(plan, { now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(backup).toBe(`${path}.pocketdeck-backup-20260102-030405`);
    expect(await readFile(backup!, "utf8")).toBe(JSON.stringify(theirs, null, 2));
    expect(JSON.parse(await readFile(path, "utf8")).hooks.PermissionRequest).toBeDefined();
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect((await readdir(dir)).some((f) => f.includes("tmp"))).toBe(false);
    expect((await planInstall(path, cmd)).diff).toBe("");
  });
  it("refuses invalid JSON without writing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ nope");
    await expect(planInstall(path, cmd)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(path, "utf8")).toBe("{ nope");
  });
  it("creates a missing file without a backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-"));
    const plan = await planInstall(join(dir, "sub", "settings.json"), cmd);
    expect(await applyInstall(plan)).toBeNull();
    expect(JSON.parse(await readFile(plan.path, "utf8")).hooks.Stop).toBeDefined();
  });
  it("formats backup names", () => {
    expect(backupName("/x/s.json", new Date(2026, 11, 31, 23, 59, 9))).toBe("/x/s.json.pocketdeck-backup-20261231-235909");
  });
});

describe("unifiedDiff", () => {
  it("is empty for equal text and marks changes otherwise", () => {
    expect(unifiedDiff("a\nb", "a\nb")).toBe("");
    const d = unifiedDiff("a\nb\nc", "a\nx\nc");
    expect(d).toContain("- b");
    expect(d).toContain("+ x");
  });
});
