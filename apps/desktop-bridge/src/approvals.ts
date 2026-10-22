import { randomUUID } from "node:crypto";
import { APPROVAL_TTL_MS, approvalHash, checkDecision, displayCommand, type MessageOf } from "@pocketdeck/protocol";

export type Outcome = "allow" | "deny" | "expired" | "terminal";

interface Pending {
  requestId: string;
  sessionId: string;
  hash: string;
  expiresAt: number;
  truncated: boolean;
  resolve: (o: Outcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalInput {
  agent: string;
  sessionId: string;
  tool: string;
  command: string;
}

export type ApprovalMsg = Omit<MessageOf<"approval">, "v" | "ts" | "type">;

export class ApprovalManager {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttl = APPROVAL_TTL_MS,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  /** Registers a request and returns the message for the phone plus a promise for the outcome. */
  create(input: ApprovalInput): { msg: ApprovalMsg; outcome: Promise<Outcome>; requestId: string; hash: string } {
    const requestId = randomUUID();
    const hash = approvalHash({ ...input, requestId });
    const shown = displayCommand(input.command);
    const expiresAt = this.now() + this.ttl;
    let resolve!: (o: Outcome) => void;
    const outcome = new Promise<Outcome>((r) => (resolve = r));
    const timer = setTimeout(() => this.finish(requestId, "expired"), this.ttl);
    this.pending.set(requestId, { requestId, sessionId: input.sessionId, hash, expiresAt, truncated: shown.truncated, resolve, timer });
    return {
      requestId,
      hash,
      outcome,
      msg: {
        requestId,
        sessionId: input.sessionId,
        agent: input.agent,
        tool: input.tool,
        command: shown.command,
        truncated: shown.truncated,
        hash,
        expiresAt,
      },
    };
  }

  /** Applies a phone decision. Returns an error reason when it is ignored; ignored decisions never resolve anything. */
  decide(d: { requestId: string; hash: string; decision: "allow" | "deny"; auth: "biometric" | "screenlock" | "none" }): { ok: true } | { ok: false; reason: string } {
    const p = this.pending.get(d.requestId);
    const check = checkDecision(p, d, this.now());
    if (!check.ok) {
      if (check.reason === "expired") this.finish(d.requestId, "expired");
      return { ok: false, reason: check.reason };
    }
    if (d.decision === "allow") {
      if (p?.truncated) return { ok: false, reason: "truncated command can only be denied" };
      if (d.auth === "none") return { ok: false, reason: "allow requires biometrics or screen lock" };
    }
    this.finish(d.requestId, d.decision);
    return { ok: true };
  }

  /** The user answered in the terminal, or the hook went away. */
  cancel(requestId: string, outcome: Outcome = "terminal"): void {
    this.finish(requestId, outcome);
  }

  hashOf(requestId: string): string | undefined {
    return this.pending.get(requestId)?.hash;
  }

  private finish(requestId: string, outcome: Outcome): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.resolve(outcome);
  }
}
