# Architecture (draft)

## Components

- **Desktop bridge** (Node/TypeScript or Rust): per-agent adapters, local session store, outbound connection to the relay. Pairs with a phone via QR code.
- **Relay**: a stateless WebSocket forwarder between exactly two peers (computer and phone). Deployable on Cloudflare Workers or a small VPS. Sees only encrypted frames.
- **Mobile app**: cross-platform (React Native/Expo suggested to start). Sessions list, session detail, approvals, push, voice input.
- **Protocol package**: versioned JSON message schemas (sessions, events, approval requests and decisions, instructions, peek signaling).

## Agent adapters

Prefer, in order:
1. Official hooks (Claude Code, Gemini CLI, Codex hooks) for events and approvals.
2. Official SDKs/APIs for starting and resuming sessions.
3. PTY wrapping as a fallback for tools with neither.

Each adapter normalizes to one event vocabulary: `session.start`, `prompt`, `tool.pre`, `tool.post`, `approval.request`, `question`, `diff`, `stop`, `error`.

## Security model

- QR pairing creates a shared key; all content is end-to-end encrypted.
- The relay authenticates use of the relay only; it cannot read content.
- Approvals are bound to the exact pending request (hash of agent, session, tool, command) and expire.
- Allow requires phone biometrics or screen lock; Deny does not.
- Long commands are never approvable from the phone if truncated on screen.
- Peek is off by default and requires an explicit per-session grant.

## Peek

Capture a single window or region, encode, send peer-to-peer over WebRTC (relay used only for signaling). Viewport-based so text stays readable on small screens.

## Cloud runner (later)

Per-task sandbox (container/microVM) with the same bridge inside it, reached through the same relay. Out of scope until Events and Peek ship.
