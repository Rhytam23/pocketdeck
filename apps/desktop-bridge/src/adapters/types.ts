import type { EventKind, SessionState } from "@pocketdeck/protocol";

export interface NormalizedEvent {
  kind: EventKind;
  tool?: string;
  summary?: string;
  text?: string;
  diff?: string;
}

export interface PermissionAsk {
  tool: string;
  /** Full, untruncated command or tool input. This is what the approval hash covers. */
  command: string;
}

export interface Normalized {
  agent: string;
  sessionId: string;
  cwd: string;
  events: NormalizedEvent[];
  stateAfter?: SessionState;
  permission?: PermissionAsk;
  /** Path to read the last assistant turn from, when the agent exposes one. */
  transcriptPath?: string;
}

/** One adapter per agent. Hooks are preferred, then SDKs, then PTY wrapping (see ARCHITECTURE.md). */
export interface AgentAdapter {
  readonly name: string;
  normalize(raw: unknown): Normalized | null;
}
