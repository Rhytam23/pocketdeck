import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalHash, MAX_COMMAND_DISPLAY } from "@pocketdeck/protocol";
import { ApprovalManager } from "../src/approvals.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const input = { agent: "claude-code", sessionId: "s", tool: "Bash", command: "ls" };

describe("ApprovalManager", () => {
  it("binds the hash to the full request and resolves on a matching decision", async () => {
    const m = new ApprovalManager();
    const { msg, outcome, requestId } = m.create(input);
    expect(msg.hash).toBe(approvalHash({ ...input, requestId }));
    expect(m.decide({ requestId, hash: msg.hash, decision: "allow", auth: "biometric" })).toEqual({ ok: true });
    expect(await outcome).toBe("allow");
    expect(m.size).toBe(0);
  });
  it("ignores mismatched, unknown and unauthenticated allow decisions", async () => {
    const m = new ApprovalManager();
    const { msg, outcome, requestId } = m.create(input);
    expect(m.decide({ requestId, hash: "0".repeat(64), decision: "allow", auth: "biometric" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(m.decide({ requestId: "nope", hash: msg.hash, decision: "allow", auth: "biometric" })).toMatchObject({ ok: false, reason: "unknown" });
    expect(m.decide({ requestId, hash: msg.hash, decision: "allow", auth: "none" })).toMatchObject({ ok: false });
    expect(m.size).toBe(1);
    expect(m.decide({ requestId, hash: msg.hash, decision: "deny", auth: "none" })).toEqual({ ok: true });
    expect(await outcome).toBe("deny");
  });
  it("only allows deny for truncated commands", async () => {
    const m = new ApprovalManager();
    const { msg, outcome, requestId } = m.create({ ...input, command: "x".repeat(MAX_COMMAND_DISPLAY + 5) });
    expect(msg.truncated).toBe(true);
    expect(m.decide({ requestId, hash: msg.hash, decision: "allow", auth: "biometric" })).toMatchObject({ ok: false });
    m.decide({ requestId, hash: msg.hash, decision: "deny", auth: "none" });
    expect(await outcome).toBe("deny");
  });
  it("expires after about two minutes and then ignores late decisions", async () => {
    const m = new ApprovalManager();
    const { msg, outcome, requestId } = m.create(input);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toBe("expired");
    expect(m.decide({ requestId, hash: msg.hash, decision: "allow", auth: "biometric" })).toMatchObject({ ok: false, reason: "unknown" });
  });
  it("cancel resolves as terminal", async () => {
    const m = new ApprovalManager();
    const { outcome, requestId } = m.create(input);
    m.cancel(requestId);
    expect(await outcome).toBe("terminal");
  });
});
