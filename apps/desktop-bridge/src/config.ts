import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Non-secret state. Secrets (bridge private key, pairing secret) live in the keystore. */
export interface Config {
  relay: string;
  room: string;
  accessKey?: string;
  machineId: string;
  deviceName: string;
  bridgeKey: string;
  phoneKey?: string;
  pushToken?: string;
  /** Channel counters, so replay protection survives restarts. */
  recvCounter: string;
  sendCounter: string;
}

export async function loadConfig(dir: string): Promise<Config | null> {
  try {
    return JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as Config;
  } catch {
    return null;
  }
}

export async function saveConfig(dir: string, c: Config): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `config.json.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  await rename(tmp, join(dir, "config.json"));
}
