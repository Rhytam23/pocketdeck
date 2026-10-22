import { ClientControl, MAX_FRAME_BYTES, type RelayErrorCode, type ServerControl } from "@pocketdeck/protocol/relay";
import { tokenHash, type Role } from "@pocketdeck/protocol/crypto";

export interface Conn {
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface HubConfig {
  /** Accepted access keys. Empty means unconfigured. */
  accessKeys: readonly string[];
  /** Explicit opt-in to run without an access key gate. */
  allowOpen: boolean;
  maxFrameBytes?: number;
  /** Frames allowed per second per connection, with a burst of twice that. */
  ratePerSecond?: number;
  now?: () => number;
}

interface Room {
  hash: string;
  pc?: ConnState;
  phone?: ConnState;
}

export interface ConnState {
  conn: Conn;
  room?: Room;
  roomId?: string;
  role?: Role;
  tokens: number;
  last: number;
  closed: boolean;
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Pure forwarding logic with no I/O of its own. It parses only the plaintext join frame;
 * everything after that is opaque bytes passed to the other role.
 */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly maxFrame: number;
  private readonly rate: number;
  private readonly now: () => number;

  constructor(private readonly cfg: HubConfig) {
    this.maxFrame = cfg.maxFrameBytes ?? MAX_FRAME_BYTES;
    this.rate = cfg.ratePerSecond ?? 50;
    this.now = cfg.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  open(conn: Conn): ConnState {
    return { conn, tokens: this.rate * 2, last: this.now(), closed: false };
  }

  private fail(s: ConnState, code: RelayErrorCode): void {
    this.control(s, { t: "error", code });
    this.close(s);
  }

  private control(s: ConnState, c: ServerControl): void {
    try {
      s.conn.send(JSON.stringify(c));
    } catch {
      /* peer gone */
    }
  }

  private close(s: ConnState): void {
    if (s.closed) return;
    s.closed = true;
    try {
      s.conn.close();
    } catch {
      /* already closed */
    }
    this.detach(s);
  }

  private detach(s: ConnState): void {
    const room = s.room;
    if (!room || !s.role) return;
    if (room[s.role] === s) {
      room[s.role] = undefined;
      const other = room[s.role === "pc" ? "phone" : "pc"];
      if (other) this.control(other, { t: "peer", online: false });
    }
    if (!room.pc && !room.phone && s.roomId) this.rooms.delete(s.roomId);
  }

  private accessOk(key: string | undefined): boolean | "unconfigured" {
    if (this.cfg.accessKeys.length === 0) return this.cfg.allowOpen ? true : "unconfigured";
    if (key === undefined) return false;
    let ok = false;
    for (const k of this.cfg.accessKeys) if (timingSafeEqual(k, key)) ok = true;
    return ok;
  }

  message(s: ConnState, data: string | Uint8Array): void {
    if (s.closed) return;
    const size = typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
    if (size > this.maxFrame) return this.fail(s, "frame_too_large");

    const t = this.now();
    s.tokens = Math.min(this.rate * 2, s.tokens + ((t - s.last) / 1000) * this.rate);
    s.last = t;
    if (s.tokens < 1) return this.fail(s, "rate_limited");
    s.tokens -= 1;

    if (!s.room) return this.join(s, data);
    if (typeof data === "string") return this.fail(s, "protocol");
    const room = s.room;
    const other = room[s.role === "pc" ? "phone" : "pc"];
    if (other && !other.closed) {
      try {
        other.conn.send(data);
      } catch {
        /* peer gone; its close handler cleans up */
      }
    }
  }

  private join(s: ConnState, data: string | Uint8Array): void {
    if (typeof data !== "string") return this.fail(s, "bad_join");
    let c: ClientControl;
    try {
      c = ClientControl.parse(JSON.parse(data));
    } catch {
      return this.fail(s, "bad_join");
    }
    const access = this.accessOk(c.accessKey);
    if (access === "unconfigured") return this.fail(s, "unconfigured");
    if (!access) return this.fail(s, "access_denied");

    const hash = tokenHash(c.token);
    let room = this.rooms.get(c.room);
    if (!room) {
      room = { hash };
      this.rooms.set(c.room, room);
    } else if (!timingSafeEqual(room.hash, hash)) {
      return this.fail(s, "bad_token");
    }
    const previous = room[c.role];
    s.room = room;
    s.roomId = c.room;
    s.role = c.role;
    room[c.role] = s;
    // A reconnect replaces a stale connection for the same role.
    if (previous && previous !== s) {
      previous.closed = true;
      try {
        previous.conn.close();
      } catch {
        /* ignore */
      }
    }
    const other = room[c.role === "pc" ? "phone" : "pc"];
    this.control(s, { t: "joined", peer: !!other });
    if (other) this.control(other, { t: "peer", online: true });
  }

  closed(s: ConnState): void {
    s.closed = true;
    this.detach(s);
  }
}

export function parseKeys(v: string | undefined): string[] {
  return (v ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}
