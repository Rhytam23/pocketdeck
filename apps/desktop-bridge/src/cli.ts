#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import QRCode from "qrcode";
import { applyInstall, hookCommand, planInstall } from "./installer.js";
import { openKeyStore } from "./keystore.js";
import { claudeSettingsPath, stateDir } from "./paths.js";
import { createPairing, startRuntime } from "./runtime.js";

const HELP = `pocketdeck <command>

  pair --relay <wss://...> [--access-key <key>] [--name <label>]
        Create keys, print a QR code, wait for the phone, then keep running.
  start Run the bridge (after pairing).
  install-hooks [--yes]   Show a diff, back up, then add PocketDeck hooks to ~/.claude/settings.json.
  uninstall-hooks [--yes] Remove only PocketDeck's hooks (same diff and backup).
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function hooks(remove: boolean, yes: boolean): Promise<void> {
  const script = join(dirname(fileURLToPath(import.meta.url)), "hook.js");
  if (!remove) {
    await access(script).catch(() => {
      throw new Error(`${script} not found. Run \`npm run build -w @pocketdeck/desktop-bridge\` first.`);
    });
  }
  const plan = await planInstall(claudeSettingsPath(), remove ? null : hookCommand(script, process.execPath));
  if (!plan.diff) return void console.log("Nothing to change; settings already up to date.");
  console.log(plan.diff + "\n");
  if (!yes && !(await confirm(`Write these changes to ${plan.path}? A dated backup is made first.`))) {
    return void console.log("Aborted. Nothing was changed.");
  }
  const backup = await applyInstall(plan);
  console.log(backup ? `Done. Backup: ${backup}` : "Done (new file created).");
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const dir = stateDir();
  switch (cmd) {
    case "install-hooks":
      return hooks(false, args.includes("--yes"));
    case "uninstall-hooks":
      return hooks(true, args.includes("--yes"));
    case "pair": {
      const relay = flag(args, "relay");
      if (!relay) throw new Error("--relay <wss://...> is required");
      const keys = await openKeyStore(dir);
      const { uri } = await createPairing(dir, keys, { relay, accessKey: flag(args, "access-key"), name: flag(args, "name") });
      console.log(await QRCode.toString(uri, { type: "terminal", small: true }));
      console.log("Scan this with the PocketDeck app. It contains a secret: do not share a screenshot of it.\n" + `(manual code: ${uri})\n`);
      await startRuntime({ dir, keys, acceptPairing: true, log: (s) => console.log(s), onPaired: () => console.log("Paired. Leave this running, or restart later with `pocketdeck start`.") });
      return new Promise(() => undefined);
    }
    case "start": {
      const keys = await openKeyStore(dir);
      await startRuntime({ dir, keys, log: (s) => console.log(s) });
      console.log("PocketDeck bridge running.");
      return new Promise(() => undefined);
    }
    default:
      console.log(HELP);
  }
}

main().catch((e: Error) => {
  console.error(`pocketdeck: ${e.message}`);
  process.exit(1);
});
