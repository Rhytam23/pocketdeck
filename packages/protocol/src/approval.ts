import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalJson, utf8 } from "./encoding.js";
import { MAX_COMMAND_DISPLAY } from "./messages.js";

export const APPROVAL_TTL_MS = 2 * 60 * 1000;

export interface ApprovalBinding {
  agent: string;
  sessionId: string;
  tool: string;
  /** The FULL command or tool input, never the truncated display form. */
  command: string;
  requestId: string;
}

/** Hash binding a decision to the exact pending request. */
export function approvalHash(b: ApprovalBinding): string {
  const { agent, sessionId, tool, command, requestId } = b;
  return bytesToHex(sha256(utf8(canonicalJson({ agent, sessionId, tool, command, requestId }))));
}

export function displayCommand(command: string): { command: string; truncated: boolean } {
  if (command.length <= MAX_COMMAND_DISPLAY) return { command, truncated: false };
  return { command: command.slice(0, MAX_COMMAND_DISPLAY), truncated: true };
}

export interface PendingApproval {
  requestId: string;
  hash: string;
  expiresAt: number;
}

export type DecisionCheck = { ok: true } | { ok: false; reason: "unknown" | "mismatch" | "expired" };

/** Bridge-side check: a decision counts only if it matches a live pending request exactly. */
export function checkDecision(
  pending: PendingApproval | undefined,
  d: { requestId: string; hash: string },
  now: number,
): DecisionCheck {
  if (!pending || pending.requestId !== d.requestId) return { ok: false, reason: "unknown" };
  if (pending.hash !== d.hash) return { ok: false, reason: "mismatch" };
  if (now >= pending.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Phone-side rule: truncated commands can only be denied; allow needs real auth. */
export function canAllow(a: { truncated: boolean; expiresAt: number }, now: number): boolean {
  return !a.truncated && now < a.expiresAt;
}

export function allowAuthAcceptable(auth: "biometric" | "screenlock" | "none"): boolean {
  return auth === "biometric" || auth === "screenlock";
}
