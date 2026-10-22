import { describe, expect, it, vi } from "vitest";
import { msg, type Message } from "@pocketdeck/protocol";
import { claudeAdapter } from "../src/adapters/claude.js";
import { Bridge, type BridgeLink } from "../src/bridge.js";

class FakeLink implements BridgeLink {
  online = true;
  paired = true;
  sent: Message[] = [];
  send(m: Message) { this.sent.push(m); }
  of<T extends Message["type"]>(t: T) { return this.sent.filter((m): m is Extract<Message, { type: T }> => m.type === t); }
}

const perm = { session_id: "s1", cwd: "/w", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf x" } };
const noClose = () => undefined;

function make(over: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) {
  const link = new FakeLink();
  const push = vi.fn(async () => undefined);
  const resume = vi.fn(async () => ({ code: 0, stderr: "" }));
  const onPushToken = vi.fn();
  const bridge = new Bridge({ link, adapter: claudeAdapter, deviceName: "pc", machineId: "m", onPushToken, push, resume, ...over });
  return { link, bridge, push, resume, onPushToken };
}

describe("Bridge approvals", () => {
  it("round trips an approval and returns the phone's decision", async () => {
    const { link, bridge } = make();
    const p = bridge.handleHook(perm, noClose);
    const a = link.of("approval")[0]!;
    expect(a.command).toBe("rm -rf x");
    await bridge.handlePhone(msg("decision", { requestId: a.requestId, hash: a.hash, decision: "allow", auth: "biometric" }));
    expect(await p).toEqual({ decision: "allow" });
    expect(link.of("approvalResolved")[0]).toMatchObject({ requestId: a.requestId, outcome: "allow" });
    expect(bridge.store.get("s1")?.state).toBe("running");
  });
  it("denies without auth requirements", async () => {
    const { link, bridge } = make();
    const p = bridge.handleHook(perm, noClose);
    const a = link.of("approval")[0]!;
    await bridge.handlePhone(msg("decision", { requestId: a.requestId, hash: a.hash, decision: "deny", auth: "none" }));
    expect((await p).decision).toBe("deny");
  });
  it("ignores a decision with the wrong hash and tells the phone", async () => {
    const { link, bridge } = make();
    const p = bridge.handleHook(perm, noClose);
    const a = link.of("approval")[0]!;
    await bridge.handlePhone(msg("decision", { requestId: a.requestId, hash: "f".repeat(64), decision: "allow", auth: "biometric" }));
    expect(link.of("error")[0]).toMatchObject({ code: "mismatch", ref: a.requestId });
    await bridge.handlePhone(msg("decision", { requestId: a.requestId, hash: a.hash, decision: "deny", auth: "none" }));
    expect((await p).decision).toBe("deny");
  });
  it("falls back to the terminal when the phone never answers (expiry)", async () => {
    vi.useFakeTimers();
    const { bridge } = make();
    const p = bridge.handleHook(perm, noClose);
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await p).toEqual({ decision: "none" });
    vi.useRealTimers();
  });
  it("does not hold the agent when not paired or phone unreachable without push", async () => {
    const a = make();
    a.link.paired = false;
    expect(await a.bridge.handleHook(perm, noClose)).toEqual({ decision: "none" });
    const b = make();
    b.link.online = false;
    expect(await b.bridge.handleHook(perm, noClose)).toEqual({ decision: "none" });
    expect(b.link.of("approval")).toHaveLength(0);
  });
  it("pushes and waits a short grace period when the phone is offline but has a push token", async () => {
    vi.useFakeTimers();
    const { link, bridge, push } = make({ pushToken: "ExponentPushToken[x]", offlineGraceMs: 1000 });
    link.online = false;
    const p = bridge.handleHook(perm, noClose);
    expect(push).toHaveBeenCalledWith("ExponentPushToken[x]", "A session needs your approval");
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toEqual({ decision: "none" });
    vi.useRealTimers();
  });
  it("replays pending approvals when the phone reconnects", async () => {
    const { link, bridge } = make();
    void bridge.handleHook(perm, noClose);
    link.sent.length = 0;
    await bridge.handlePhone(msg("hello", { role: "phone", deviceName: "p" }));
    expect(link.of("welcome")).toHaveLength(1);
    expect(link.of("sessions")[0]?.sessions[0]?.state).toBe("needs_approval");
    expect(link.of("approval")).toHaveLength(1);
    expect(link.of("event").length).toBeGreaterThan(0);
  });
  it("cancels the approval when the hook disconnects (answered in the terminal)", async () => {
    const { bridge } = make();
    let close!: () => void;
    const p = bridge.handleHook(perm, (cb) => (close = cb));
    close();
    expect(await p).toEqual({ decision: "none" });
    expect(bridge.approvals.size).toBe(0);
  });
  it("stores a push token from hello", async () => {
    const { bridge, onPushToken } = make();
    await bridge.handlePhone(msg("hello", { role: "phone", deviceName: "p", pushToken: "tok" }));
    expect(onPushToken).toHaveBeenCalledWith("tok");
  });
});

describe("Bridge instructions", () => {
  const idle = { session_id: "s1", cwd: "/w", hook_event_name: "Stop" };
  it("resumes an idle session in its cwd with the text, once", async () => {
    const { bridge, resume } = make();
    await bridge.handleHook(idle, noClose);
    const m = msg("instruction", { id: "i1", sessionId: "s1", text: "run tests" });
    await bridge.handlePhone(m);
    await bridge.handlePhone(m);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith("s1", "/w", "run tests");
  });
  it("refuses busy and unknown sessions", async () => {
    const { bridge, link, resume } = make();
    await bridge.handleHook({ ...idle, hook_event_name: "UserPromptSubmit", prompt: "x" }, noClose);
    await bridge.handlePhone(msg("instruction", { id: "i1", sessionId: "s1", text: "go" }));
    await bridge.handlePhone(msg("instruction", { id: "i2", sessionId: "nope", text: "go" }));
    expect(link.of("error").map((e) => e.code)).toEqual(["bad_request", "not_found"]);
    expect(resume).not.toHaveBeenCalled();
  });
  it("reports resume failures as an error event", async () => {
    const { bridge, link } = make({ resume: async () => ({ code: 1, stderr: "boom" }) });
    await bridge.handleHook(idle, noClose);
    await bridge.handlePhone(msg("instruction", { id: "i1", sessionId: "s1", text: "go" }));
    expect(link.of("event").some((e) => e.kind === "error" && e.text === "boom")).toBe(true);
    expect(bridge.store.get("s1")?.state).toBe("error");
  });
});

describe("Bridge events", () => {
  it("streams events and keeps last turn from the transcript", async () => {
    const { bridge, link } = make({ readTranscript: async () => "finished" });
    await bridge.handleHook({ session_id: "s1", cwd: "/w", hook_event_name: "Stop", transcript_path: "/t" }, noClose);
    expect(link.of("event")[0]?.kind).toBe("stop");
    expect(bridge.store.get("s1")?.lastTurn).toBe("finished");
  });
  it("ignores unknown hook input without throwing", async () => {
    const { bridge } = make();
    expect(await bridge.handleHook({ nonsense: 1 }, noClose)).toEqual({ decision: "none" });
  });
});
