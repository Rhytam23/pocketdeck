import { msg, type Message, type MessageOf } from "@pocketdeck/protocol";
import { lastAssistantText } from "./adapters/claude.js";
import type { AgentAdapter } from "./adapters/types.js";
import { ApprovalManager, type ApprovalMsg } from "./approvals.js";
import type { ResumeFn } from "./instructions.js";
import type { PushFn } from "./push.js";
import { SessionStore } from "./sessions.js";

export interface BridgeLink {
  readonly online: boolean;
  readonly paired: boolean;
  send(m: Message): void;
}

export interface BridgeDeps {
  link: BridgeLink;
  adapter: AgentAdapter;
  deviceName: string;
  machineId: string;
  pushToken?: string;
  onPushToken(token: string): void;
  push: PushFn;
  resume: ResumeFn;
  store?: SessionStore;
  approvals?: ApprovalManager;
  now?: () => number;
  /** How long a paired-but-offline phone gets to come online (e.g. via a push) before we fall back to the terminal. */
  offlineGraceMs?: number;
  readTranscript?: (path: string) => Promise<string | undefined>;
}

export type HookDecision = { decision: "allow" | "deny" | "none"; message?: string };

const DEFAULT_GRACE_MS = 25_000;

export class Bridge {
  readonly store: SessionStore;
  readonly approvals: ApprovalManager;
  private readonly pendingMsgs = new Map<string, ApprovalMsg>();
  private readonly seenInstructions = new Set<string>();
  private pushToken?: string;
  private readonly onlineWaiters = new Set<() => void>();

  constructor(private readonly d: BridgeDeps) {
    this.store = d.store ?? new SessionStore(d.now);
    this.approvals = d.approvals ?? new ApprovalManager(d.now);
    this.pushToken = d.pushToken;
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private send<T extends MessageOf<"event" | "sessions" | "approval" | "approvalResolved" | "welcome" | "pong" | "error">["type"]>(
    type: T,
    fields: Omit<Extract<Message, { type: T }>, "v" | "ts" | "type">,
  ): void {
    this.d.link.send(msg(type, fields, this.now()));
  }

  private sendSessions(): void {
    this.send("sessions", { sessions: this.store.list() });
  }

  /** Called by the link when the phone's presence changes. */
  peerChanged(online: boolean): void {
    if (online) this.onlineWaiters.forEach((w) => w());
  }

  /** A hook invocation from Claude Code. Resolves with what the hook command should print. */
  async handleHook(raw: unknown, onClose: (cb: () => void) => void): Promise<HookDecision> {
    const n = this.d.adapter.normalize(raw);
    if (!n) return { decision: "none" };

    let lastTurn: string | undefined;
    if (n.events.some((e) => e.kind === "stop") && n.transcriptPath) {
      lastTurn = await (this.d.readTranscript ?? lastAssistantText)(n.transcriptPath);
    }
    this.store.touch(n.sessionId, n.agent, n.cwd, { state: n.stateAfter, lastTurn });
    for (const e of n.events) {
      const stored = this.store.addEvent(n.sessionId, n.agent, e.kind, { tool: e.tool, summary: e.summary, text: e.text, diff: e.diff });
      if (this.d.link.online) this.d.link.send(msg("event", stripTs(stored), stored.ts));
      if (e.kind === "question" && this.pushToken) void this.d.push(this.pushToken, "A session is waiting for you");
    }
    if (this.d.link.online) this.sendSessions();

    if (!n.permission) return { decision: "none" };
    return this.awaitApproval(n.agent, n.sessionId, n.cwd, n.permission, onClose);
  }

  private async awaitApproval(
    agent: string,
    sessionId: string,
    cwd: string,
    ask: { tool: string; command: string },
    onClose: (cb: () => void) => void,
  ): Promise<HookDecision> {
    // Never hold the agent for a phone that cannot be reached.
    if (!this.d.link.paired) return this.fallThrough(sessionId, cwd, agent);
    if (!this.d.link.online && !this.pushToken) return this.fallThrough(sessionId, cwd, agent);

    const { requestId, msg: approval, outcome } = this.approvals.create({ agent, sessionId, tool: ask.tool, command: ask.command });
    this.pendingMsgs.set(requestId, approval);
    onClose(() => this.approvals.cancel(requestId, "terminal"));

    if (this.d.link.online) this.send("approval", approval);
    else if (this.pushToken) {
      void this.d.push(this.pushToken, "A session needs your approval");
      const grace = this.d.offlineGraceMs ?? DEFAULT_GRACE_MS;
      const timer = setTimeout(() => {
        if (!this.d.link.online) this.approvals.cancel(requestId, "terminal");
      }, grace);
      outcome.finally(() => clearTimeout(timer));
    }
    if (this.d.link.online && this.pushToken) void this.d.push(this.pushToken, "A session needs your approval");

    const result = await outcome;
    this.pendingMsgs.delete(requestId);
    if (this.d.link.online) this.send("approvalResolved", { requestId, hash: approval.hash, outcome: result });
    this.store.touch(sessionId, agent, cwd, { state: "running" });
    if (this.d.link.online) this.sendSessions();
    if (result === "allow") return { decision: "allow" };
    if (result === "deny") return { decision: "deny", message: "Denied from PocketDeck" };
    return { decision: "none" };
  }

  private fallThrough(sessionId: string, cwd: string, agent: string): HookDecision {
    this.store.touch(sessionId, agent, cwd, { state: "running" });
    return { decision: "none" };
  }

  /** A decrypted message from the phone. */
  async handlePhone(m: Message): Promise<void> {
    switch (m.type) {
      case "hello":
        if (m.pushToken && m.pushToken !== this.pushToken) {
          this.pushToken = m.pushToken;
          this.d.onPushToken(m.pushToken);
        }
        this.send("welcome", { deviceName: this.d.deviceName, machineId: this.d.machineId });
        this.sendSessions();
        for (const e of this.store.recentEvents()) this.d.link.send(msg("event", stripTs(e), e.ts));
        for (const a of this.pendingMsgs.values()) this.send("approval", a);
        return;
      case "ping":
        this.send("pong", { nonce: m.nonce });
        return;
      case "decision": {
        const r = this.approvals.decide(m);
        if (!r.ok) this.send("error", { code: r.reason === "expired" ? "expired" : r.reason === "unknown" ? "not_found" : "mismatch", message: `Decision ignored: ${r.reason}`, ref: m.requestId });
        return;
      }
      case "instruction":
        await this.instruct(m);
        return;
      default:
        return;
    }
  }

  private async instruct(m: MessageOf<"instruction">): Promise<void> {
    if (this.seenInstructions.has(m.id)) return;
    this.seenInstructions.add(m.id);
    const s = this.store.get(m.sessionId);
    if (!s || !s.cwd) return this.send("error", { code: "not_found", message: "Unknown session", ref: m.id });
    if (s.state === "running" || s.state === "needs_approval") {
      return this.send("error", { code: "bad_request", message: "Session is busy; wait for it to finish", ref: m.id });
    }
    this.store.touch(s.id, s.agent, s.cwd, { state: "running" });
    this.sendSessions();
    const e = this.store.addEvent(s.id, s.agent, "prompt", { text: m.text, summary: "From phone" });
    this.d.link.send(msg("event", stripTs(e), e.ts));
    const res = await this.d.resume(s.id, s.cwd, m.text);
    if (res.code !== 0) {
      this.store.touch(s.id, s.agent, s.cwd, { state: "error" });
      const err = this.store.addEvent(s.id, s.agent, "error", { text: (res.stderr || `claude exited with ${res.code}`).slice(0, 2000) });
      this.d.link.send(msg("event", stripTs(err), err.ts));
      this.sendSessions();
    }
    // On success the resumed session reports itself through its own hooks.
  }
}

function stripTs<T extends { ts: number }>(e: T): Omit<T, "ts"> {
  const { ts, ...rest } = e;
  void ts;
  return rest;
}
