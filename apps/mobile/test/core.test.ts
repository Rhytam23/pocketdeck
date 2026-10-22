import { describe, expect, it } from "vitest";
import { msg } from "@pocketdeck/protocol";
import { approvalView, buildDecision } from "../src/core/approval.js";
import { initialState, liveApprovals, reducer, sessionLabel, sortSessions, type ApprovalItem } from "../src/core/state.js";

const hash = "a".repeat(64);
const appr = (over: Partial<ApprovalItem> = {}): ApprovalItem => ({
  ts: 0, requestId: "r1", sessionId: "s1", agent: "claude-code", tool: "Bash", command: "ls", truncated: false, hash, expiresAt: 10_000, ...over,
});
const sess = (id: string, state: "idle" | "running" | "needs_approval" | "ended" | "error", updatedAt: number, cwd = "/home/me/proj") =>
  ({ id, agent: "claude-code", cwd, state, updatedAt });

describe("reducer", () => {
  it("clears replayed state on welcome, then rebuilds from the replay", () => {
    let s = reducer(initialState, { type: "msg", m: msg("event", { sessionId: "s1", agent: "a", kind: "stop" }) });
    s = reducer(s, { type: "msg", m: msg("welcome", { deviceName: "pc", machineId: "m" }) });
    expect(s.events).toEqual({});
    expect(s.conn).toBe("online");
    s = reducer(s, { type: "msg", m: msg("sessions", { sessions: [sess("s1", "idle", 1)] }) });
    s = reducer(s, { type: "msg", m: msg("event", { sessionId: "s1", agent: "a", kind: "tool.pre", tool: "Bash" }) });
    expect(s.sessions).toHaveLength(1);
    expect(s.events.s1).toHaveLength(1);
  });
  it("adds approvals once and removes them when resolved", () => {
    const a = msg("approval", { requestId: "r1", sessionId: "s1", agent: "a", tool: "Bash", command: "ls", truncated: false, hash, expiresAt: 5 });
    let s = reducer(initialState, { type: "msg", m: a });
    s = reducer(s, { type: "msg", m: a });
    expect(s.approvals).toHaveLength(1);
    expect(liveApprovals(s, 4)).toHaveLength(1);
    expect(liveApprovals(s, 5)).toHaveLength(0);
    s = reducer(s, { type: "msg", m: msg("approvalResolved", { requestId: "r1", hash, outcome: "allow" }) });
    expect(s.approvals).toHaveLength(0);
  });
  it("surfaces errors as notices", () => {
    const s = reducer(initialState, { type: "msg", m: msg("error", { code: "mismatch", message: "ignored" }) });
    expect(s.notice).toBe("ignored");
    expect(reducer(s, { type: "dismissNotice" }).notice).toBeUndefined();
  });
  it("sorts sessions so ones needing you come first", () => {
    const order = sortSessions([sess("a", "idle", 9), sess("b", "needs_approval", 1), sess("c", "running", 5), sess("d", "error", 3)]).map((s) => s.id);
    expect(order).toEqual(["b", "d", "c", "a"]);
  });
  it("labels sessions by title or folder name", () => {
    expect(sessionLabel(sess("abcdefghij", "idle", 1))).toBe("proj");
    expect(sessionLabel(sess("abcdefghij", "idle", 1, ""))).toBe("abcdefgh");
    expect(sessionLabel({ ...sess("a", "idle", 1), title: "Fix bug" })).toBe("Fix bug");
  });
});

describe("approval rules on the phone", () => {
  it("disables allow for truncated and expired requests", () => {
    expect(approvalView(appr(), 1000)).toMatchObject({ allowEnabled: true, secondsLeft: 9 });
    expect(approvalView(appr({ truncated: true }), 1000)).toMatchObject({ allowEnabled: false });
    expect(approvalView(appr({ truncated: true }), 1000).allowBlockedReason).toMatch(/only deny/);
    expect(approvalView(appr(), 10_000)).toMatchObject({ allowEnabled: false, expired: true, allowBlockedReason: "Expired" });
  });
  it("builds a bound decision; allow needs real auth, deny does not", () => {
    expect(buildDecision(appr(), "allow", "biometric", 0)).toMatchObject({ type: "decision", requestId: "r1", hash, decision: "allow", auth: "biometric" });
    expect(buildDecision(appr(), "allow", "screenlock", 0).auth).toBe("screenlock");
    expect(() => buildDecision(appr(), "allow", "none", 0)).toThrow(/screen lock/);
    expect(() => buildDecision(appr({ truncated: true }), "allow", "biometric", 0)).toThrow();
    expect(() => buildDecision(appr(), "allow", "biometric", 20_000)).toThrow();
    expect(buildDecision(appr({ truncated: true }), "deny", "none", 0).decision).toBe("deny");
  });
});
