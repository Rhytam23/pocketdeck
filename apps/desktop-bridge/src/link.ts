import WebSocket from "ws";
import {
  Channel, DecryptError, deriveSessionKeys, fromBase64Url, handshakePublicKey, isHandshakeFrame, joinToken, toBase64Url,
  type KeyPair,
} from "@pocketdeck/protocol/crypto";
import type { Message } from "@pocketdeck/protocol";

export interface LinkKeys {
  bridge: KeyPair;
  pairingSecret: Uint8Array;
  phonePublic?: Uint8Array;
}

export interface LinkOptions {
  url: string;
  room: string;
  accessKey?: string;
  keys: LinkKeys;
  counters?: { send: string; recv: string };
  /** Accept a first-contact handshake from a new phone (only while `pair` is running). */
  acceptPairing: boolean;
  onMessage(m: Message): void;
  onPeer(online: boolean): void;
  onPaired(phonePublic: Uint8Array): void;
  onCounters(c: { send: string; recv: string }): void;
  onStatus?(s: string): void;
}

const SEND_COUNTER_RESERVE = 1000n;

/** Relay client with reconnect. Owns the encrypted Channel; callers see only decrypted Messages. */
export class RelayLink {
  private ws?: WebSocket;
  private channel?: Channel;
  private stopped = false;
  private retry = 0;
  private sendLimit = 0n;
  private peerOnline = false;

  constructor(private readonly o: LinkOptions) {
    if (o.keys.phonePublic) this.setChannel(o.keys.phonePublic);
    if (o.counters && this.channel) {
      const send = BigInt(o.counters.send) + SEND_COUNTER_RESERVE;
      this.channel.restore({ send: send.toString(), recv: o.counters.recv });
      this.sendLimit = send + SEND_COUNTER_RESERVE;
      this.persist();
    }
  }

  get online(): boolean {
    return this.peerOnline && !!this.channel && this.ws?.readyState === WebSocket.OPEN;
  }

  endPairing(): void {
    this.o.acceptPairing = false;
  }

  get paired(): boolean {
    return !!this.channel;
  }

  private setChannel(phonePublic: Uint8Array): void {
    this.channel = new Channel(deriveSessionKeys("pc", this.o.keys.bridge.secretKey, phonePublic, this.o.keys.pairingSecret));
  }

  private persist(): void {
    if (this.channel) this.o.onCounters(this.channel.state());
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(`${this.o.url.replace(/\/$/, "")}/v1/${this.o.room}`, { maxPayload: 512 * 1024 });
    this.ws = ws;
    ws.on("open", () => {
      this.retry = 0;
      this.o.onStatus?.("connected");
      ws.send(
        JSON.stringify({ t: "join", room: this.o.room, role: "pc", token: joinToken(this.o.keys.pairingSecret), accessKey: this.o.accessKey }),
      );
    });
    ws.on("message", (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
      if (isBinary) this.onFrame(new Uint8Array(buf));
      else this.onControl(buf.toString("utf8"));
    });
    const down = () => {
      if (this.ws !== ws) return;
      this.peerOnline = false;
      this.o.onPeer(false);
      this.o.onStatus?.("disconnected");
      if (!this.stopped) setTimeout(() => this.connect(), Math.min(30_000, 500 * 2 ** this.retry++));
    };
    ws.on("close", down);
    ws.on("error", () => ws.terminate());
  }

  private onControl(text: string): void {
    try {
      const c = JSON.parse(text) as { t: string; peer?: boolean; online?: boolean; code?: string };
      if (c.t === "joined") this.setPeer(!!c.peer);
      else if (c.t === "peer") this.setPeer(!!c.online);
      else if (c.t === "error") this.o.onStatus?.(`relay error: ${c.code}`);
    } catch {
      /* ignore */
    }
  }

  private setPeer(online: boolean): void {
    this.peerOnline = online;
    this.o.onPeer(online);
  }

  private onFrame(frame: Uint8Array): void {
    try {
      if (isHandshakeFrame(frame)) {
        if (!this.o.acceptPairing) return;
        const pub = handshakePublicKey(frame);
        if (!pub) return;
        const trial = new Channel(deriveSessionKeys("pc", this.o.keys.bridge.secretKey, pub, this.o.keys.pairingSecret));
        const m = trial.open(frame);
        this.channel = trial;
        this.persist();
        this.o.onPaired(pub);
        this.o.onMessage(m);
        return;
      }
      if (!this.channel) return;
      const m = this.channel.open(frame);
      this.persist();
      this.o.onMessage(m);
    } catch (e) {
      if (!(e instanceof DecryptError)) this.o.onStatus?.(`bad frame: ${(e as Error).message}`);
    }
  }

  send(m: Message): void {
    if (!this.channel || this.ws?.readyState !== WebSocket.OPEN) return;
    const frame = this.channel.seal(m);
    if (BigInt(this.channel.state().send) >= this.sendLimit) {
      this.sendLimit += SEND_COUNTER_RESERVE;
      this.persist();
    }
    this.ws.send(frame);
  }
}

export { toBase64Url, fromBase64Url };
