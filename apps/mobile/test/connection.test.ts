import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { msg, type Message } from "@pocketdeck/protocol";
import {
  Channel, decodePairingUri, deriveSessionKeys, encodePairingUri, generateKeyPair, generatePairingSecret,
  generateRoomId, handshakePublicKey, joinToken, toBase64Url,
} from "@pocketdeck/protocol/crypto";
import { startRelay, type NodeRelay } from "../../relay/src/node.js";
import { PhoneConnection, type Persisted, type WSLike } from "../src/core/connection.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const until = async (f: () => boolean, ms = 4000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** Stand-in for the desktop bridge: owns the PC end of the channel. */
async function fakeBridge(port: number) {
  const bridge = generateKeyPair();
  const secret = generatePairingSecret();
  const room = generateRoomId();
  const payload = decodePairingUri(encodePairingUri({
    v: 1, relay: `ws://127.0.0.1:${port}`, room, bridgeKey: toBase64Url(bridge.publicKey), secret: toBase64Url(secret), accessKey: "gate", name: "pc",
  }));
  const ws = new WebSocket(`${payload.relay}/v1/${room}`);
  let ch: Channel | undefined;
  const got: Message[] = [];
  const frames: Uint8Array[] = [];
  ws.on("message", (d, bin) => {
    if (!bin) return;
    const f = new Uint8Array(d as Buffer);
    frames.push(f);
    const pub = handshakePublicKey(f);
    if (pub && !ch) ch = new Channel(deriveSessionKeys("pc", bridge.secretKey, pub, secret));
    got.push(ch!.open(f));
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "join", room, role: "pc", token: joinToken(secret), accessKey: "gate" }));
  cleanup.push(() => ws.close());
  return { payload, got, frames, send: (m: Message) => ws.send(ch!.seal(m)) };
}

describe("PhoneConnection", () => {
  it("connects through the relay, handshakes once, and exchanges encrypted messages", async () => {
    const relay: NodeRelay = await startRelay({ accessKeys: ["gate"], allowOpen: false }, 0);
    cleanup.push(() => relay.close());
    const pc = await fakeBridge((relay.server.address() as { port: number }).port);
    const received: Message[] = [];
    const statuses: string[] = [];
    let persisted: Persisted = { handshakeDone: false };
    const conn = new PhoneConnection({
      payload: pc.payload, keys: generateKeyPair(), persisted, deviceName: "sim", pushToken: () => "tok",
      createSocket: (url) => new WebSocket(url) as unknown as WSLike,
      onMessage: (m) => received.push(m), onStatus: (s) => statuses.push(s), onPersist: (p) => (persisted = p),
    });
    conn.start();
    cleanup.push(() => conn.stop());
    await until(() => pc.got.some((m) => m.type === "hello"));
    expect(pc.got[0]).toMatchObject({ type: "hello", deviceName: "sim", pushToken: "tok" });
    expect(handshakePublicKey(pc.frames[0]!)).not.toBeNull();
    pc.send(msg("welcome", { deviceName: "pc", machineId: "m" }));
    await until(() => received.length === 1);
    expect(persisted.handshakeDone).toBe(true);
    expect(statuses).toContain("online");
    conn.send(msg("ping", { nonce: "n" }));
    await until(() => pc.got.length === 2);
    expect(handshakePublicKey(pc.frames[1]!)).toBeNull(); // plain data frame after the handshake
  });

  it("resumes with persisted counters so the bridge accepts it after an app restart", async () => {
    const relay: NodeRelay = await startRelay({ accessKeys: ["gate"], allowOpen: false }, 0);
    cleanup.push(() => relay.close());
    const pc = await fakeBridge((relay.server.address() as { port: number }).port);
    const keys = generateKeyPair();
    let persisted: Persisted = { handshakeDone: false };
    const make = () => new PhoneConnection({
      payload: pc.payload, keys, persisted, deviceName: "sim",
      createSocket: (url) => new WebSocket(url) as unknown as WSLike,
      onMessage: () => undefined, onStatus: () => undefined, onPersist: (p) => (persisted = p),
    });
    const a = make();
    a.start();
    await until(() => pc.got.length === 1);
    pc.send(msg("welcome", { deviceName: "pc", machineId: "m" }));
    await until(() => persisted.handshakeDone);
    a.stop();
    const b = make(); // new instance, same persisted state: counters jump ahead, so no replay rejection
    b.start();
    cleanup.push(() => b.stop());
    await until(() => pc.got.length === 2);
    expect(pc.got[1]).toMatchObject({ type: "hello" });
  });
});
