import type { Message, MessageOf, SessionSummary } from "@pocketdeck/protocol";

export type ConnStatus = "connecting" | "relay" | "online" | "offline";
export type EventItem = Omit<MessageOf<"event">, "v" | "type">;
export type ApprovalItem = Omit<MessageOf<"approval">, "v" | "type">;

export interface AppState {
  conn: ConnStatus;
  deviceName?: string;
  sessions: SessionSummary[];
  events: Record<string, EventItem[]>;
  approvals: ApprovalItem[];
  notice?: string;
}

export const initialState: AppState = { conn: "offline", sessions: [], events: {}, approvals: [] };

export type Action =
  | { type: "conn"; status: ConnStatus }
  | { type: "msg"; m: Message }
  | { type: "dismissNotice" };

const MAX_EVENTS = 200;

export function reducer(s: AppState, a: Action): AppState {
  if (a.type === "conn") return { ...s, conn: a.status };
  if (a.type === "dismissNotice") return { ...s, notice: undefined };
  const m = a.m;
  switch (m.type) {
    case "welcome":
      // The bridge replays sessions, events and pending approvals after welcome, so start clean.
      return { ...s, deviceName: m.deviceName, conn: "online", events: {}, approvals: [] };
    case "sessions":
      return { ...s, sessions: m.sessions };
    case "event": {
      const list = [...(s.events[m.sessionId] ?? []), { ...m }];
      return { ...s, events: { ...s.events, [m.sessionId]: list.slice(-MAX_EVENTS) } };
    }
    case "approval": {
      const { v: _v, type: _t, ...item } = m;
      void _v;
      void _t;
      if (s.approvals.some((x) => x.requestId === item.requestId)) return s;
      return { ...s, approvals: [...s.approvals, item] };
    }
    case "approvalResolved":
      return { ...s, approvals: s.approvals.filter((x) => x.requestId !== m.requestId) };
    case "error":
      return { ...s, notice: m.message };
    default:
      return s;
  }
}

const RANK: Record<SessionSummary["state"], number> = { needs_approval: 0, error: 1, running: 2, idle: 3, ended: 4 };

/** "Needs you" first, then by recency. */
export function sortSessions(list: SessionSummary[]): SessionSummary[] {
  return [...list].sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt);
}

export function liveApprovals(s: AppState, now: number): ApprovalItem[] {
  return s.approvals.filter((a) => a.expiresAt > now);
}

export function sessionLabel(s: SessionSummary): string {
  if (s.title) return s.title;
  const dir = s.cwd.split(/[\\/]/).filter(Boolean).at(-1);
  return dir ?? s.id.slice(0, 8);
}

export const STATE_TEXT: Record<SessionSummary["state"], string> = {
  needs_approval: "Needs you",
  error: "Error",
  running: "Working",
  idle: "Idle",
  ended: "Ended",
};
