import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/** Normalized event vocabulary shared by every agent adapter. */
export const EVENT_KINDS = [
  "session.start",
  "prompt",
  "tool.pre",
  "tool.post",
  "approval.request",
  "question",
  "diff",
  "stop",
  "error",
] as const;
export const EventKind = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKind>;

export const SESSION_STATES = ["idle", "running", "needs_approval", "ended", "error"] as const;
export const SessionState = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionState>;

const id = z.string().min(1).max(128);
const ts = z.number().int().nonnegative();
const text = (max: number) => z.string().max(max);

export const MAX_COMMAND_DISPLAY = 2000;
export const MAX_TEXT = 20_000;
export const MAX_DIFF = 100_000;

export const SessionSummary = z.object({
  id,
  agent: z.string().min(1).max(64),
  cwd: text(1024),
  title: text(200).optional(),
  state: SessionState,
  updatedAt: ts,
  lastTurn: text(MAX_TEXT).optional(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

const base = { v: z.literal(PROTOCOL_VERSION), ts };

export const Hello = z.object({
  ...base,
  type: z.literal("hello"),
  role: z.enum(["pc", "phone"]),
  deviceName: text(100),
  /** Expo push token; only sent phone to pc, inside the encrypted channel. */
  pushToken: text(300).optional(),
});

export const Welcome = z.object({
  ...base,
  type: z.literal("welcome"),
  deviceName: text(100),
  machineId: id,
});

export const Sessions = z.object({
  ...base,
  type: z.literal("sessions"),
  sessions: z.array(SessionSummary).max(500),
});

export const Event = z.object({
  ...base,
  type: z.literal("event"),
  sessionId: id,
  agent: z.string().min(1).max(64),
  kind: EventKind,
  tool: text(100).optional(),
  /** Short human summary, e.g. "Edit src/app.ts". */
  summary: text(500).optional(),
  text: text(MAX_TEXT).optional(),
  diff: text(MAX_DIFF).optional(),
});

export const Approval = z.object({
  ...base,
  type: z.literal("approval"),
  requestId: id,
  sessionId: id,
  agent: z.string().min(1).max(64),
  tool: text(100),
  /** Possibly truncated for display. The hash always covers the full command. */
  command: text(MAX_COMMAND_DISPLAY),
  truncated: z.boolean(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: ts,
});

export const ApprovalOutcome = z.enum(["allow", "deny", "expired", "terminal"]);
export const ApprovalResolved = z.object({
  ...base,
  type: z.literal("approvalResolved"),
  requestId: id,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: ApprovalOutcome,
});

export const Decision = z.object({
  ...base,
  type: z.literal("decision"),
  requestId: id,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(["allow", "deny"]),
  /** How the user was authenticated on the phone. Allow requires biometric or screenlock. */
  auth: z.enum(["biometric", "screenlock", "none"]),
});

export const Instruction = z.object({
  ...base,
  type: z.literal("instruction"),
  id,
  sessionId: id,
  text: z.string().min(1).max(MAX_TEXT),
});

export const Ping = z.object({ ...base, type: z.literal("ping"), nonce: id });
export const Pong = z.object({ ...base, type: z.literal("pong"), nonce: id });

export const ErrorMsg = z.object({
  ...base,
  type: z.literal("error"),
  code: z.enum(["bad_request", "unsupported_version", "expired", "mismatch", "not_found", "internal"]),
  message: text(500),
  ref: id.optional(),
});

export const Message = z.discriminatedUnion("type", [
  Hello,
  Welcome,
  Sessions,
  Event,
  Approval,
  ApprovalResolved,
  Decision,
  Instruction,
  Ping,
  Pong,
  ErrorMsg,
]);
export type Message = z.infer<typeof Message>;
export type MessageType = Message["type"];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

export function parseMessage(input: unknown): Message {
  return Message.parse(input);
}

/** Builds a message with version and timestamp filled in. */
export function msg<T extends MessageType>(
  type: T,
  fields: Omit<MessageOf<T>, "v" | "ts" | "type">,
  now: number = Date.now(),
): MessageOf<T> {
  return { v: PROTOCOL_VERSION, ts: now, type, ...fields } as MessageOf<T>;
}
