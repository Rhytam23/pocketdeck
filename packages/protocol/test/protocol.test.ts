import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_TTL_MS, EVENT_KINDS, allowAuthAcceptable, approvalHash, canAllow, canonicalJson,
  checkDecision, displayCommand, msg, parseMessage, MAX_COMMAND_DISPLAY,
} from "../src/index.js";
import {
  Channel, DecryptError, decodePairingUri, deriveSessionKeys, encodePairingUri, fromBase64Url,
  generateKeyPair, generatePairingSecret, generateRoomId, handshakePublicKey, joinToken,
  toBase64Url, tokenHash,
} from "../src/crypto.js";
import { ClientControl } from "../src/relay.js";
import { V } from "./vectors.js";

describe("vocabulary", () => {
  it("matches ARCHITECTURE.md", () => {
    expect([...EVENT_KINDS]).toEqual([
      "session.start", "prompt", "tool.pre", "tool.post", "approval.request", "question", "diff", "stop", "error",
    ]);
  });
});

describe("messages", () => {
  it("round trips every message type", () => {
    const hash = "a".repeat(64);
    const all = [
      msg("hello", { role: "phone", deviceName: "Pixel" }),
      msg("welcome", { deviceName: "laptop", machineId: "m1" }),
      msg("sessions", { sessions: [{ id: "s", agent: "claude-code", cwd: "/x", state: "idle", updatedAt: 1 }] }),
      msg("event", { sessionId: "s", agent: "claude-code", kind: "tool.pre", tool: "Bash" }),
      msg("approval", { requestId: "r", sessionId: "s", agent: "a", tool: "Bash", command: "ls", truncated: false, hash, expiresAt: 5 }),
      msg("approvalResolved", { requestId: "r", hash, outcome: "allow" }),
      msg("decision", { requestId: "r", hash, decision: "deny", auth: "none" }),
      msg("instruction", { id: "i", sessionId: "s", text: "go" }),
      msg("ping", { nonce: "n" }),
      msg("pong", { nonce: "n" }),
      msg("error", { code: "expired", message: "late" }),
    ];
    for (const m of all) expect(parseMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("rejects wrong version, unknown types and bad hashes", () => {
    expect(() => parseMessage({ v: 2, ts: 1, type: "ping", nonce: "n" })).toThrow();
    expect(() => parseMessage({ v: 1, ts: 1, type: "nope" })).toThrow();
    expect(() => parseMessage({ v: 1, ts: 1, type: "decision", requestId: "r", hash: "xyz", decision: "allow", auth: "biometric" })).toThrow();
    expect(() => parseMessage({ v: 1, ts: 1, type: "instruction", id: "i", sessionId: "s", text: "" })).toThrow();
  });
});

describe("canonical json and approval hash", () => {
  it("matches vectors", () => {
    expect(canonicalJson(V.canonicalIn)).toBe(V.canonicalOut);
    expect(approvalHash(V.approval)).toBe(V.approvalHash);
  });
  it("changes when any bound field changes", () => {
    for (const k of Object.keys(V.approval) as (keyof typeof V.approval)[]) {
      expect(approvalHash({ ...V.approval, [k]: V.approval[k] + "x" })).not.toBe(V.approvalHash);
    }
  });
});

describe("approval rules", () => {
  const pending = { requestId: "r1", hash: V.approvalHash, expiresAt: 1000 };
  it("accepts only an exact, live match", () => {
    expect(checkDecision(pending, { requestId: "r1", hash: V.approvalHash }, 999)).toEqual({ ok: true });
    expect(checkDecision(pending, { requestId: "r1", hash: V.approvalHash }, 1000)).toEqual({ ok: false, reason: "expired" });
    expect(checkDecision(pending, { requestId: "r1", hash: "0".repeat(64) }, 1)).toEqual({ ok: false, reason: "mismatch" });
    expect(checkDecision(pending, { requestId: "r2", hash: V.approvalHash }, 1)).toEqual({ ok: false, reason: "unknown" });
    expect(checkDecision(undefined, { requestId: "r1", hash: V.approvalHash }, 1)).toEqual({ ok: false, reason: "unknown" });
  });
  it("truncates for display and blocks allow when truncated", () => {
    const long = "x".repeat(MAX_COMMAND_DISPLAY + 1);
    const d = displayCommand(long);
    expect(d.truncated).toBe(true);
    expect(d.command.length).toBe(MAX_COMMAND_DISPLAY);
    expect(canAllow({ truncated: true, expiresAt: 10 }, 1)).toBe(false);
    expect(canAllow({ truncated: false, expiresAt: 10 }, 1)).toBe(true);
    expect(canAllow({ truncated: false, expiresAt: 10 }, 10)).toBe(false);
    expect(displayCommand("ls").truncated).toBe(false);
  });
  it("requires real auth for allow", () => {
    expect(allowAuthAcceptable("biometric")).toBe(true);
    expect(allowAuthAcceptable("screenlock")).toBe(true);
    expect(allowAuthAcceptable("none")).toBe(false);
    expect(APPROVAL_TTL_MS).toBe(120000);
  });
});

describe("key derivation", () => {
  it("matches vectors on both sides", () => {
    expect(bytesToHex(x25519.getPublicKey(V.bridgeSecret))).toBe(V.bridgePublicHex);
    expect(bytesToHex(x25519.getPublicKey(V.phoneSecret))).toBe(V.phonePublicHex);
    expect(joinToken(V.pairingSecret)).toBe(V.joinToken);
    expect(tokenHash(V.joinToken)).toBe(V.joinTokenHash);
    const pc = deriveSessionKeys("pc", V.bridgeSecret, x25519.getPublicKey(V.phoneSecret), V.pairingSecret);
    const ph = deriveSessionKeys("phone", V.phoneSecret, x25519.getPublicKey(V.bridgeSecret), V.pairingSecret);
    expect(bytesToHex(pc.send)).toBe(V.bridgeSendKeyHex);
    expect(bytesToHex(pc.recv)).toBe(V.bridgeRecvKeyHex);
    expect(ph.send).toEqual(pc.recv);
    expect(ph.recv).toEqual(pc.send);
  });
  it("different pairing secret gives different keys and join token", () => {
    const other = generatePairingSecret();
    const a = deriveSessionKeys("pc", V.bridgeSecret, x25519.getPublicKey(V.phoneSecret), V.pairingSecret);
    const b = deriveSessionKeys("pc", V.bridgeSecret, x25519.getPublicKey(V.phoneSecret), other);
    expect(a.send).not.toEqual(b.send);
    expect(joinToken(other)).not.toBe(V.joinToken);
  });
  it("join token is not any content key", () => {
    expect(bytesToHex(fromBase64Url(V.joinToken))).not.toBe(V.bridgeSendKeyHex);
  });
});

function pair() {
  const bridge = generateKeyPair();
  const phone = generateKeyPair();
  const secret = generatePairingSecret();
  const pc = new Channel(deriveSessionKeys("pc", bridge.secretKey, phone.publicKey, secret));
  const ph = new Channel(deriveSessionKeys("phone", phone.secretKey, bridge.publicKey, secret));
  return { pc, ph, phone, bridge, secret };
}

describe("channel", () => {
  it("round trips in both directions, with a handshake first frame", () => {
    const { pc, ph, phone } = pair();
    const hello = msg("hello", { role: "phone", deviceName: "p" });
    const frame = ph.seal(hello, phone.publicKey);
    expect(handshakePublicKey(frame)).toEqual(phone.publicKey);
    expect(pc.open(frame)).toEqual(hello);
    const w = msg("welcome", { deviceName: "pc", machineId: "m" });
    expect(ph.open(pc.seal(w))).toEqual(w);
    const ping = msg("ping", { nonce: "1" });
    expect(pc.open(ph.seal(ping))).toEqual(ping);
  });
  it("rejects replays, reordering, tampering and wrong keys", () => {
    const { pc, ph } = pair();
    const f1 = ph.seal(msg("ping", { nonce: "1" }));
    const f2 = ph.seal(msg("ping", { nonce: "2" }));
    pc.open(f2);
    expect(() => pc.open(f2)).toThrow(DecryptError);
    expect(() => pc.open(f1)).toThrow(DecryptError);
    const f3 = ph.seal(msg("ping", { nonce: "3" }));
    const bad = f3.slice();
    bad[bad.length - 1] = (bad[bad.length - 1] as number) ^ 1;
    expect(() => pc.open(bad)).toThrow(DecryptError);
    const stranger = pair().pc;
    expect(() => stranger.open(f3)).toThrow(DecryptError);
    expect(() => pc.open(new Uint8Array(3))).toThrow(DecryptError);
  });
  it("does not accept its own frames (no reflection)", () => {
    const { ph } = pair();
    expect(() => ph.open(ph.seal(msg("ping", { nonce: "x" })))).toThrow(DecryptError);
  });
  it("authenticates the handshake public key", () => {
    const { pc, ph, phone } = pair();
    const frame = ph.seal(msg("ping", { nonce: "x" }), phone.publicKey);
    const forged = frame.slice();
    forged[5] = (forged[5] as number) ^ 1;
    expect(() => pc.open(forged)).toThrow(DecryptError);
  });
  it("persists counters across restarts", () => {
    const { pc, ph } = pair();
    pc.open(ph.seal(msg("ping", { nonce: "1" })));
    const saved = pc.state();
    const replay = ph.seal(msg("ping", { nonce: "2" }));
    pc.open(replay);
    pc.restore(saved);
    expect(() => pc.open(replay)).not.toThrow();
  });
});

describe("pairing and relay envelope", () => {
  it("encodes and decodes the QR payload", () => {
    const p = {
      v: 1 as const, relay: "wss://relay.example.com", room: generateRoomId(),
      bridgeKey: toBase64Url(generateKeyPair().publicKey), secret: toBase64Url(generatePairingSecret()), name: "laptop",
    };
    expect(decodePairingUri(encodePairingUri(p))).toEqual(p);
    expect(() => decodePairingUri("https://x")).toThrow();
    expect(() => decodePairingUri("pocketdeck://pair?d=" + toBase64Url(new TextEncoder().encode("{}")))).toThrow();
  });
  it("validates join frames", () => {
    const ok = { t: "join", room: generateRoomId(), role: "pc", token: V.joinToken };
    expect(ClientControl.parse(ok)).toEqual(ok);
    expect(() => ClientControl.parse({ ...ok, token: "short" })).toThrow();
    expect(() => ClientControl.parse({ ...ok, role: "admin" })).toThrow();
  });
  it("base64url round trips", () => {
    for (let n = 0; n < 40; n++) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      expect(fromBase64Url(toBase64Url(b))).toEqual(b);
    }
    expect(() => fromBase64Url("a+b")).toThrow();
  });
});
