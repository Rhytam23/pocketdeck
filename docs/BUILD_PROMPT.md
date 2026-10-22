# Build prompt for Claude Code

Paste everything below the line into Claude Code, opened in the root of this repo.

---

You are building **PocketDeck**, an open-source (MIT), phone-first app to watch, steer and approve AI coding agents running on a user's computer. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/PRIOR_ART.md` first. Your job right now is **Stage 0 and Stage 1 only**. Do not build Peek or Cloud runner.

## Goal of this run

A working end-to-end MVP: from a phone I can see my Claude Code sessions on my computer, get a push notification when one needs approval, approve or deny it, and send the next instruction. Everything between phone and computer is end-to-end encrypted through an untrusted relay.

## Deliverables

1. **`packages/protocol`** (TypeScript, zod or JSON Schema): versioned messages `hello`, `welcome`, `sessions`, `event`, `approval`, `approvalResolved`, `decision`, `instruction`, `ping/pong`, `error`. Include test vectors and unit tests. Define the normalized event vocabulary from `docs/ARCHITECTURE.md`.
2. **`apps/relay`**: stateless WebSocket forwarder (Cloudflare Worker with Durable Object, plus a plain Node version for self-hosting). Rooms with exactly two roles (`pc`, `phone`), access-key gate, join proof, frame size and rate limits, fail closed if unconfigured. It must never see content keys.
3. **`apps/desktop-bridge`** (Node/TypeScript): 
   - Claude Code adapter via official hooks: installer that merges into `~/.claude/settings.json` only after showing a diff and making a dated backup; hook command that forwards events to the bridge over a local socket or named pipe and never blocks the agent if the bridge is down.
   - Approval flow: `PermissionRequest` waits for the phone decision with a timeout, then falls back to the terminal.
   - Instruction flow: resume the session in its working directory with the phone's text.
   - QR pairing, key storage in the OS keystore, outbound connection to the relay.
4. **`apps/mobile`** (React Native + Expo, TypeScript): pairing by QR scan, sessions list with state, session detail (steps, diffs, last turn), approve/deny cards, instruction input, push notifications, biometric gate on Allow.
5. **CI** (GitHub Actions): lint, typecheck and tests for every package.
6. **Docs**: update README status, add `docs/SECURITY.md` (threat model) and a getting-started guide.

## Hard rules

- End-to-end encryption with a libsodium-style construction (or Noise); do not invent crypto. Pairing key never goes to the relay.
- Approvals are bound to the exact pending request (hash of agent, session, tool, command, request id) and expire after about 2 minutes. A late or mismatched decision is ignored.
- Allow needs phone biometrics or screen lock. Deny does not. If the command was truncated for display, the phone can only Deny.
- Never overwrite user config files without backup, diff and confirmation. Never block the agent. No telemetry, no account.
- No secrets in git. Add a `SECURITY.md` and keep dependencies minimal.
- Phone first: every screen must be usable one-handed at 375px width.

## How to work

1. Start by writing a short plan in `docs/PLAN-stage1.md`, then implement package by package: protocol, relay, bridge, mobile.
2. Write tests alongside code. Run lint, typecheck and tests before each commit.
3. Make small commits with clear messages. Open a PR per package rather than one giant change.
4. If a decision is genuinely ambiguous (framework choice, crypto library), pick the conventional option, record it in `docs/DECISIONS.md` with the reason, and continue.
5. At the end, report what works, what is stubbed, and what you could not verify (for example anything needing a real phone or push credentials).

## Definition of done

A fresh clone can: start the relay locally, run the bridge, pair the Expo app by QR, run Claude Code with hooks installed, and see the session appear on the phone, with an approval round trip working. Provide a script or doc that reproduces this demo.
