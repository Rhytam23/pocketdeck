import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from "./encoding.js";
import { Message } from "./messages.js";

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  return x25519.keygen();
}

export function generatePairingSecret(): Uint8Array {
  return randomBytes(32);
}

export function generateRoomId(): string {
  return toBase64Url(randomBytes(24));
}

/** Token the relay uses to gate a room. HKDF is one-way, so the relay cannot reach the content keys. */
export function joinToken(pairingSecret: Uint8Array): string {
  return toBase64Url(hkdf(sha256, pairingSecret, undefined, utf8("pocketdeck/v1/relay-join"), 32));
}

export function tokenHash(token: string): string {
  return toBase64Url(sha256(utf8(token)));
}

export type Role = "pc" | "phone";

export interface SessionKeys {
  send: Uint8Array;
  recv: Uint8Array;
}

/**
 * Per-direction keys from X25519 plus the pairing secret.
 * The bridge's role is "pc"; its static key is in the QR code, the phone's is sent in its first frame.
 */
export function deriveSessionKeys(
  role: Role,
  ownSecret: Uint8Array,
  peerPublic: Uint8Array,
  pairingSecret: Uint8Array,
): SessionKeys {
  const dh = x25519.getSharedSecret(ownSecret, peerPublic);
  const okm = hkdf(sha256, dh, pairingSecret, utf8("pocketdeck/v1/session"), 64);
  const pcToPhone = okm.slice(0, 32);
  const phoneToPc = okm.slice(32, 64);
  return role === "pc"
    ? { send: pcToPhone, recv: phoneToPc }
    : { send: phoneToPc, recv: pcToPhone };
}

const FRAME_HANDSHAKE = 1;
const FRAME_DATA = 2;
const NONCE = 24;
const PUB = 32;

export class DecryptError extends Error {}

/**
 * One direction-aware encrypted channel. Frame layout:
 *   type(1) [phonePublicKey(32) if handshake] nonce(24) ciphertext
 * Plaintext is counter(8, big endian) || JSON. The type byte (and public key) are authenticated as AAD.
 * Receivers reject any counter not strictly greater than the last accepted one.
 */
export class Channel {
  private sendCounter = 0n;
  private recvCounter = 0n;

  constructor(private readonly keys: SessionKeys) {}

  /** Restores counters after a restart so replay protection survives reconnects. */
  state(): { send: string; recv: string } {
    return { send: this.sendCounter.toString(), recv: this.recvCounter.toString() };
  }
  restore(s: { send: string; recv: string }): void {
    this.sendCounter = BigInt(s.send);
    this.recvCounter = BigInt(s.recv);
  }

  seal(message: Message, handshakePublicKey?: Uint8Array): Uint8Array {
    const type = handshakePublicKey ? FRAME_HANDSHAKE : FRAME_DATA;
    const header = handshakePublicKey ? concat(Uint8Array.of(type), handshakePublicKey) : Uint8Array.of(type);
    this.sendCounter += 1n;
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(0, this.sendCounter);
    const plaintext = concat(counter, utf8(JSON.stringify(Message.parse(message))));
    const nonce = randomBytes(NONCE);
    const ct = xchacha20poly1305(this.keys.send, nonce, header).encrypt(plaintext);
    return concat(header, nonce, ct);
  }

  open(frame: Uint8Array): Message {
    const headerLen = frame[0] === FRAME_HANDSHAKE ? 1 + PUB : 1;
    return this.openWithHeaderLen(frame, headerLen);
  }

  private openWithHeaderLen(frame: Uint8Array, headerLen: number): Message {
    if (frame.length < headerLen + NONCE + 16 + 8) throw new DecryptError("frame too short");
    const header = frame.slice(0, headerLen);
    const nonce = frame.slice(headerLen, headerLen + NONCE);
    const ct = frame.slice(headerLen + NONCE);
    let plaintext: Uint8Array;
    try {
      plaintext = xchacha20poly1305(this.keys.recv, nonce, header).decrypt(ct);
    } catch {
      throw new DecryptError("authentication failed");
    }
    const counter = new DataView(plaintext.buffer, plaintext.byteOffset, 8).getBigUint64(0);
    if (counter <= this.recvCounter) throw new DecryptError("replayed or reordered frame");
    let parsed: Message;
    try {
      parsed = Message.parse(JSON.parse(fromUtf8(plaintext.slice(8))));
    } catch {
      throw new DecryptError("invalid message");
    }
    this.recvCounter = counter;
    return parsed;
  }
}

/** Reads the phone's public key from a handshake frame without decrypting it. */
export function handshakePublicKey(frame: Uint8Array): Uint8Array | null {
  if (frame[0] !== FRAME_HANDSHAKE || frame.length < 1 + PUB) return null;
  return frame.slice(1, 1 + PUB);
}

export function isHandshakeFrame(frame: Uint8Array): boolean {
  return frame[0] === FRAME_HANDSHAKE;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** What the bridge encodes into the pairing QR code. Never sent to the relay. */
export const PairingPayload = z.object({
  v: z.literal(1),
  relay: z.string().url().max(300),
  room: z.string().min(22).max(64),
  bridgeKey: z.string().length(43),
  secret: z.string().length(43),
  /** Access key for the relay, when the relay requires one. */
  accessKey: z.string().max(200).optional(),
  name: z.string().max(100),
});
export type PairingPayload = z.infer<typeof PairingPayload>;

const PAIR_PREFIX = "pocketdeck://pair?d=";

export function encodePairingUri(p: PairingPayload): string {
  return PAIR_PREFIX + toBase64Url(utf8(JSON.stringify(PairingPayload.parse(p))));
}

export function decodePairingUri(uri: string): PairingPayload {
  if (!uri.startsWith(PAIR_PREFIX)) throw new Error("not a PocketDeck pairing code");
  return PairingPayload.parse(JSON.parse(fromUtf8(fromBase64Url(uri.slice(PAIR_PREFIX.length)))));
}

export { toBase64Url, fromBase64Url };
