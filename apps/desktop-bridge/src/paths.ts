import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.POCKETDECK_HOME ?? join(homedir(), ".pocketdeck");
}

export function socketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\pocketdeck-${userInfo().username}`;
  return join(stateDir(env), "bridge.sock");
}

export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}
