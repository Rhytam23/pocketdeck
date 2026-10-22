import type { EventKind, MessageOf, SessionState, SessionSummary } from "@pocketdeck/protocol";

type EventMsg = Omit<MessageOf<"event">, "v" | "ts" | "type"> & { ts: number };

const MAX_EVENTS_PER_SESSION = 200;
const MAX_SESSIONS = 100;

export class SessionStore {
  private readonly sessions = new Map<string, SessionSummary>();
  private readonly events = new Map<string, EventMsg[]>();

  constructor(private readonly now: () => number = Date.now) {}

  touch(id: string, agent: string, cwd: string, patch: { state?: SessionState; lastTurn?: string; title?: string } = {}): SessionSummary {
    const prev = this.sessions.get(id);
    const next: SessionSummary = {
      id,
      agent,
      cwd: cwd || prev?.cwd || "",
      state: patch.state ?? prev?.state ?? "idle",
      updatedAt: this.now(),
      title: patch.title ?? prev?.title,
      lastTurn: patch.lastTurn ?? prev?.lastTurn,
    };
    this.sessions.set(id, next);
    this.evict();
    return next;
  }

  get(id: string): SessionSummary | undefined {
    return this.sessions.get(id);
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  addEvent(sessionId: string, agent: string, kind: EventKind, fields: { tool?: string; summary?: string; text?: string; diff?: string }): EventMsg {
    const e: EventMsg = { sessionId, agent, kind, ts: this.now(), ...fields };
    const list = this.events.get(sessionId) ?? [];
    list.push(e);
    if (list.length > MAX_EVENTS_PER_SESSION) list.shift();
    this.events.set(sessionId, list);
    return e;
  }

  recentEvents(): EventMsg[] {
    return [...this.events.values()].flat().sort((a, b) => a.ts - b.ts);
  }

  private evict(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const oldest = this.list().at(-1);
    if (oldest) {
      this.sessions.delete(oldest.id);
      this.events.delete(oldest.id);
    }
  }
}
