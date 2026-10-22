import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { msg, type Message } from "@pocketdeck/protocol";
import {
  Channel, decodePairingUri, deriveSessionKeys, fromBase64Url, generateKeyPair, joinToken,
} from "@pocketdeck/protocol/crypto";
import { startRelay, type NodeRelay } from "../../relay/src/node.js";
import { runHook } from "../src/hook.js";
import { memoryKeyStore } from "../src/keystore.js";
import { createPairing, startRuntime, type Runtime } from "../src/runtime.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

const until = async (f: () => boolean, ms = 4000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** Simulated phone: scans the QR payload, joins the relay, speaks the encrypted protocol. */
async function phone(uri: string, keypair = generateKeyPair()) {
  const p = decodePairingUri(uri);
  const secret = fromBase64Url(p.secret);
  const ch = new Channel(deriveSessionKeys("phone", keypair.secretKey, fromBase64Url(p.bridgeKey), secret));
  const ws = new WebSocket(`${p.relay}/v1/${p.room}`);
  const got: Message[] = [];
  let first = true;
  ws.on("message", (d, bin) => {
    if (bin) got.push(ch.open(new Uint8Array(d as Buffer)));
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "join", room: p.room, role: "phone", token: joinToken(secret), accessKey: p.accessKey }));
  cleanup.push(() => ws.close());
  return {
    got,
    send(m: Message, repeatHandshake = false) {
      ws.send(ch.seal(m, first || repeatHandshake ? keypair.publicKey : undefined));
      first = false;
    },
    of<T extends Message["type"]>(t: T) { return got.filter((m): m is Extract<Message, { type: T }> => m.type === t); },
  };
}

async function setup() {
  const relay: NodeRelay = await startRelay({ accessKeys: ["gate"], allowOpen: false }, 0);
  cleanup.push(() => relay.close());
  const port = (relay.server.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), "pd-e2e-"));
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\pd-e2e-${randomBytes(6).toString("hex")}` : join(dir, "bridge.sock");
  const keys = memoryKeyStore();
  const { uri } = await createPairing(dir, keys, { relay: `ws://127.0.0.1:${port}`, accessKey: "gate", name: "test-pc" });
  const resumes: unknown[][] = [];
  const pushes: string[] = [];
  const rt: Runtime = await startRuntime({
    dir, keys, socket, acceptPairing: true,
    push: async (_t, b) => void pushes.push(b),
    resume: async (...a) => { resumes.push(a); return { code: 0, stderr: "" }; },
  });
  cleanup.push(() => rt.stop());
  return { uri, socket, rt, resumes, pushes, dir, keys };
}

describe("end to end: hook -> bridge -> relay -> phone", () => {
  it("pairs, lists sessions, and completes an approval round trip", async () => {
    const { uri, socket, rt, resumes } = await setup();
    const ph = await phone(uri);
    ph.send(msg("hello", { role: "phone", deviceName: "sim", pushToken: "tok" }));
    await until(() => ph.of("welcome").length === 1);
    expect(ph.of("welcome")[0]?.deviceName).toBe("test-pc");
    expect(rt.link.paired).toBe(true);

    await runHook(JSON.stringify({ session_id: "s1", cwd: "/w", hook_event_name: "UserPromptSubmit", prompt: "hi" }), socket);
    await until(() => ph.of("sessions").some((m) => m.sessions[0]?.state === "running"));

    const hooked = runHook(JSON.stringify({ session_id: "s1", cwd: "/w", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } }), socket);
    await until(() => ph.of("approval").length === 1);
    const a = ph.of("approval")[0]!;
    // A decision for the wrong hash is ignored; the right one wins.
    ph.send(msg("decision", { requestId: a.requestId, hash: "0".repeat(64), decision: "allow", auth: "biometric" }));
    await until(() => ph.of("error").length === 1);
    ph.send(msg("decision", { requestId: a.requestId, hash: a.hash, decision: "allow", auth: "biometric" }));
    const out = JSON.parse(await hooked);
    expect(out.hookSpecificOutput.decision).toEqual({ behavior: "allow" });
    await until(() => ph.of("approvalResolved").length === 1);

    await runHook(JSON.stringify({ session_id: "s1", cwd: "/w", hook_event_name: "Stop" }), socket);
    await until(() => ph.of("sessions").at(-1)?.sessions[0]?.state === "idle");
    ph.send(msg("instruction", { id: "i1", sessionId: "s1", text: "continue" }));
    await until(() => resumes.length === 1);
    expect(resumes[0]).toEqual(["s1", "/w", "continue"]);
  });

  it("accepts a repeated handshake frame from the already paired phone", async () => {
    const { uri } = await setup();
    const ph = await phone(uri);
    ph.send(msg("hello", { role: "phone", deviceName: "sim" }));
    await until(() => ph.of("welcome").length === 1);
    ph.send(msg("hello", { role: "phone", deviceName: "sim" }), true);
    await until(() => ph.of("welcome").length === 2);
  });

  it("persists the pairing and rejects a stranger after restart", async () => {
    const { uri, rt, dir, keys, socket } = await setup();
    const ph = await phone(uri);
    ph.send(msg("hello", { role: "phone", deviceName: "sim" }));
    await until(() => ph.of("welcome").length === 1);
    await rt.stop();
    cleanup.pop();
    const rt2 = await startRuntime({ dir, keys, socket, acceptPairing: false });
    cleanup.push(() => rt2.stop());
    expect(rt2.link.paired).toBe(true);
    // A phone that did not scan the QR cannot derive working keys.
    const evil = await phone(uri, generateKeyPair());
    evil.send(msg("hello", { role: "phone", deviceName: "evil" }));
    await new Promise((r) => setTimeout(r, 300));
    expect(evil.of("welcome")).toHaveLength(0);
  });

  it("hook never blocks or throws when the bridge is down", async () => {
    const t = Date.now();
    expect(await runHook(JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "x" }), join(tmpdir(), "no-such.sock"))).toBe("");
    expect(await runHook("garbage", "/nope")).toBe("");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
