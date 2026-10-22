import type { Server } from "node:net";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { fromBase64Url, generateKeyPair, generatePairingSecret, generateRoomId, toBase64Url } from "@pocketdeck/protocol/crypto";
import { claudeAdapter } from "./adapters/claude.js";
import { Bridge } from "./bridge.js";
import { loadConfig, saveConfig, type Config } from "./config.js";
import { serveIpc } from "./ipc.js";
import { claudeResume, type ResumeFn } from "./instructions.js";
import type { KeyStore } from "./keystore.js";
import { RelayLink } from "./link.js";
import { socketPath } from "./paths.js";
import { expoPush, type PushFn } from "./push.js";
import { encodePairingUri, type PairingPayload } from "@pocketdeck/protocol/crypto";

export interface PairingSetup {
  uri: string;
  config: Config;
}

/** Creates fresh keys and a room. The returned URI goes into a QR code and never to the relay. */
export async function createPairing(dir: string, keys: KeyStore, opts: { relay: string; accessKey?: string; name?: string }): Promise<PairingSetup> {
  const bridge = generateKeyPair();
  const secret = generatePairingSecret();
  const prev = await loadConfig(dir);
  const config: Config = {
    relay: opts.relay,
    room: generateRoomId(),
    accessKey: opts.accessKey,
    machineId: prev?.machineId ?? randomUUID(),
    deviceName: opts.name ?? prev?.deviceName ?? hostname(),
    bridgeKey: toBase64Url(bridge.publicKey),
    recvCounter: "0",
    sendCounter: "0",
  };
  await keys.set("bridge-secret", toBase64Url(bridge.secretKey));
  await keys.set("pairing-secret", toBase64Url(secret));
  await saveConfig(dir, config);
  const payload: PairingPayload = {
    v: 1,
    relay: opts.relay,
    room: config.room,
    bridgeKey: config.bridgeKey,
    secret: toBase64Url(secret),
    accessKey: opts.accessKey,
    name: config.deviceName,
  };
  return { uri: encodePairingUri(payload), config };
}

export interface RuntimeOptions {
  dir: string;
  keys: KeyStore;
  acceptPairing?: boolean;
  socket?: string;
  push?: PushFn;
  resume?: ResumeFn;
  offlineGraceMs?: number;
  log?: (s: string) => void;
  onPaired?: () => void;
}

export interface Runtime {
  bridge: Bridge;
  link: RelayLink;
  stop(): Promise<void>;
}

export async function startRuntime(o: RuntimeOptions): Promise<Runtime> {
  const log = o.log ?? (() => undefined);
  const config = await loadConfig(o.dir);
  if (!config) throw new Error("Not paired yet. Run `pocketdeck pair --relay <url>` first.");
  const secretB64 = await o.keys.get("bridge-secret");
  const pairingB64 = await o.keys.get("pairing-secret");
  if (!secretB64 || !pairingB64) throw new Error("Keys missing from the keystore. Run `pocketdeck pair` again.");

  const bridgeSecret = fromBase64Url(secretB64);
  const bridgePublic = fromBase64Url(config.bridgeKey);
  let saving = Promise.resolve();
  const persist = (patch: Partial<Config>) => {
    Object.assign(config, patch);
    saving = saving.then(() => saveConfig(o.dir, config)).catch((e) => log(`could not save config: ${(e as Error).message}`));
  };

  const ref: { bridge?: Bridge } = {};
  const link = new RelayLink({
    url: config.relay,
    room: config.room,
    accessKey: config.accessKey,
    keys: {
      bridge: { secretKey: bridgeSecret, publicKey: bridgePublic },
      pairingSecret: fromBase64Url(pairingB64),
      phonePublic: config.phoneKey ? fromBase64Url(config.phoneKey) : undefined,
    },
    counters: config.phoneKey ? { send: config.sendCounter, recv: config.recvCounter } : undefined,
    acceptPairing: o.acceptPairing ?? false,
    onMessage: (m) => void ref.bridge?.handlePhone(m).catch((e) => log(`handler error: ${(e as Error).message}`)),
    onPeer: (online) => {
      log(online ? "phone online" : "phone offline");
      ref.bridge?.peerChanged(online);
    },
    onPaired: (pub) => {
      persist({ phoneKey: toBase64Url(pub) });
      link.endPairing();
      log("paired with a phone");
      o.onPaired?.();
    },
    onCounters: (c) => persist({ sendCounter: c.send, recvCounter: c.recv }),
    onStatus: log,
  });

  const bridge = new Bridge({
    link,
    adapter: claudeAdapter,
    deviceName: config.deviceName,
    machineId: config.machineId,
    pushToken: config.pushToken,
    onPushToken: (t) => persist({ pushToken: t }),
    push: o.push ?? expoPush,
    resume: o.resume ?? claudeResume(),
    offlineGraceMs: o.offlineGraceMs,
  });

  ref.bridge = bridge;
  const server: Server = await serveIpc(o.socket ?? socketPath(), async (req, onClose) => {
    const hook = (req as { hook?: unknown } | null)?.hook;
    return bridge.handleHook(hook, onClose);
  });
  link.start();

  return {
    bridge,
    link,
    async stop() {
      link.stop();
      await new Promise<void>((r) => server.close(() => r()));
      await saving;
    },
  };
}
