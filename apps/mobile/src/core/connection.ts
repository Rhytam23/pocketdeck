import {
  Channel, DecryptError, decodePairingUri, deriveSessionKeys, fromBase64Url, joinToken, type KeyPair, type PairingPayload,
} from "@pocketdeck/protocol/crypto";
import { msg, type Message } from "@pocketdeck/protocol";
import type { ConnStatus } from "./state.js";

/** The subset of the WebSocket API we use; satisfied by React Native's WebSocket and by `ws`. */
export interface WSLike {
  binaryType: string;
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string | Uint8Array): void;
  close(): void;
}
export type WSFactory = (url: string) => WSLike;

export interface Persisted {
  /** True once the bridge has answered our first handshake frame. */
  handshakeDone: boolean;
  counters?: { send: string; recv: string };
}

export interface ConnectionOptions {
  payload: PairingPayload;
  keys: KeyPair;
  persisted: Persisted;
  deviceName: string;
  pushToken?: () => string | undefined;
  createSocket: WSFactory;
  onMessage(m: Message): void;
  onStatus(s: ConnStatus): void;
  onPersist(p: Persisted): void;
}

const OPEN = 1;
const RESERVE = 1000n;

export class PhoneConnection {
  private ws?: WSLike;
  private readonly channel: Channel;
  private persisted: Persisted;
  private stopped = false;
  private retry = 0;
  private sendLimit = 0n;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly o: ConnectionOptions) {
    const secret = fromBase64Url(o.payload.secret);
    this.channel = new Channel(deriveSessionKeys("phone", o.keys.secretKey, fromBase64Url(o.payload.bridgeKey), secret));
    this.persisted = { ...o.persisted };
    if (o.persisted.counters) {
      const send = BigInt(o.persisted.counters.send) + RESERVE;
      this.channel.restore({ send: send.toString(), recv: o.persisted.counters.recv });
      this.sendLimit = send + RESERVE;
      this.save();
    }
  }

  private save(): void {
    this.persisted = { ...this.persisted, counters: this.channel.state() };
    this.o.onPersist(this.persisted);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === OPEN;
  }

  private connect(): void {
    this.o.onStatus("connecting");
    const p = this.o.payload;
    const ws = this.o.createSocket(`${p.relay.replace(/\/$/, "")}/v1/${p.room}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: "join", room: p.room, role: "phone", token: joinToken(fromBase64Url(p.secret)), accessKey: p.accessKey }));
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") this.onControl(e.data);
      else this.onFrame(new Uint8Array(e.data as ArrayBuffer));
    };
    const down = () => {
      if (this.ws !== ws) return;
      this.o.onStatus("offline");
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), Math.min(30_000, 500 * 2 ** this.retry++));
    };
    ws.onclose = down;
    ws.onerror = () => ws.close();
  }

  private onControl(text: string): void {
    let c: { t: string; peer?: boolean; online?: boolean };
    try {
      c = JSON.parse(text);
    } catch {
      return;
    }
    const peer = c.t === "joined" ? c.peer : c.t === "peer" ? c.online : undefined;
    if (peer === undefined) return;
    this.o.onStatus(peer ? "online" : "relay");
    if (peer) this.hello();
  }

  hello(): void {
    this.send(msg("hello", { role: "phone", deviceName: this.o.deviceName, pushToken: this.o.pushToken?.() }));
  }

  private onFrame(frame: Uint8Array): void {
    try {
      const m = this.channel.open(frame);
      if (!this.persisted.handshakeDone) this.persisted = { ...this.persisted, handshakeDone: true };
      this.save();
      this.o.onMessage(m);
    } catch (e) {
      if (!(e instanceof DecryptError)) throw e;
    }
  }

  send(m: Message): void {
    if (this.ws?.readyState !== OPEN) return;
    // Until the bridge has answered once, every frame carries our public key so it can set up the channel.
    const frame = this.channel.seal(m, this.persisted.handshakeDone ? undefined : this.o.keys.publicKey);
    if (BigInt(this.channel.state().send) >= this.sendLimit) {
      this.sendLimit += RESERVE;
      this.save();
    }
    this.ws.send(frame);
  }
}

export { decodePairingUri };
