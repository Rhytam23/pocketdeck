import { allowAuthAcceptable, canAllow, msg, type MessageOf } from "@pocketdeck/protocol";
import type { ApprovalItem } from "./state.js";

export type AuthLevel = "biometric" | "screenlock" | "none";

export interface ApprovalView {
  secondsLeft: number;
  expired: boolean;
  allowEnabled: boolean;
  /** Shown instead of the Allow button when it is disabled. */
  allowBlockedReason?: string;
}

export function approvalView(a: ApprovalItem, now: number): ApprovalView {
  const expired = now >= a.expiresAt;
  const allowEnabled = canAllow(a, now);
  return {
    secondsLeft: Math.max(0, Math.ceil((a.expiresAt - now) / 1000)),
    expired,
    allowEnabled,
    allowBlockedReason: expired ? "Expired" : a.truncated ? "Command too long to show in full. You can only deny it here." : undefined,
  };
}

/**
 * Builds the decision message. Deny never needs auth. Allow requires the caller to have just passed
 * a biometric or screen-lock prompt; otherwise this throws and nothing is sent.
 */
export function buildDecision(a: ApprovalItem, decision: "allow" | "deny", auth: AuthLevel, now: number): MessageOf<"decision"> {
  if (decision === "allow") {
    if (!canAllow(a, now)) throw new Error("This request can no longer be allowed from the phone");
    if (!allowAuthAcceptable(auth)) throw new Error("Set up a screen lock or biometrics to allow requests");
  }
  return msg("decision", { requestId: a.requestId, hash: a.hash, decision, auth }, now);
}
