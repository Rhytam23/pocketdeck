import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface KeyStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

const SERVICE = "pocketdeck";

/** OS keystore (Keychain, Credential Manager, Secret Service) via @napi-rs/keyring. */
export async function osKeyStore(): Promise<KeyStore> {
  const mod = (await import("@napi-rs/keyring")) as typeof import("@napi-rs/keyring");
  const entry = (name: string) => new mod.Entry(SERVICE, name);
  // Probe once so a missing backend fails here, not in the middle of pairing.
  entry("probe").getPassword();
  return {
    async get(name) {
      return entry(name).getPassword() ?? null;
    },
    async set(name, value) {
      entry(name).setPassword(value);
    },
    async delete(name) {
      try {
        entry(name).deletePassword();
      } catch {
        /* not present */
      }
    },
  };
}

/** Plain 0600 file. Only used when the user explicitly opts in because no OS keystore is available. */
export function fileKeyStore(dir: string): KeyStore {
  const file = join(dir, "secrets.json");
  const read = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = async (data: Record<string, string>) => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(data), { mode: 0o600 });
    await chmod(file, 0o600);
  };
  return {
    async get(name) {
      return (await read())[name] ?? null;
    },
    async set(name, value) {
      await write({ ...(await read()), [name]: value });
    },
    async delete(name) {
      const d = await read();
      delete d[name];
      await write(d);
    },
  };
}

export function memoryKeyStore(): KeyStore {
  const m = new Map<string, string>();
  return {
    async get(n) {
      return m.get(n) ?? null;
    },
    async set(n, v) {
      m.set(n, v);
    },
    async delete(n) {
      m.delete(n);
    },
  };
}

export async function openKeyStore(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<KeyStore> {
  if (env.POCKETDECK_INSECURE_FILE_STORE === "1") {
    console.warn("WARNING: storing keys in a plain file (POCKETDECK_INSECURE_FILE_STORE=1).");
    return fileKeyStore(dir);
  }
  try {
    return await osKeyStore();
  } catch (e) {
    throw new Error(
      `No OS keystore available (${(e as Error).message}). ` +
        "Install/unlock one (Secret Service on Linux), or set POCKETDECK_INSECURE_FILE_STORE=1 to use a 0600 file.",
    );
  }
}
