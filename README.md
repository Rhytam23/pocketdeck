# PocketDeck

**One phone app to watch, steer and approve every AI coding agent you run: any agent, any machine, phone first.**

> Status: **Stage 1 (Events MVP) implemented, not yet used by real people.** Protocol, relay, desktop bridge (Claude Code) and the Expo phone app exist with automated tests. Anything needing a real phone (camera, biometrics, push delivery) is untested. Peek and Cloud runner are not started. See [Getting started](docs/GETTING_STARTED.md) and [docs/SECURITY.md](docs/SECURITY.md).

## The problem

AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Cursor and others) run for a long time and keep stopping to ask for approval. Every vendor ships its own remote feature, and open-source tools each cover one slice: some show structured sessions, some stream the desktop, some run agents in the cloud. Nothing combines them in a phone-first app.

## The idea

Three layers; the phone always picks the cheapest one that answers your question.

1. **Events (default).** Structured sessions from any agent: steps, diffs, test results, approve or deny, send the next instruction. Tiny bandwidth, works great on a phone.
2. **Peek (on demand).** Stream just the window or region you need (browser preview, failing test, IDE panel) over peer-to-peer WebRTC.
3. **Cloud runner (optional).** Start a task in a sandbox so it keeps going when your computer is off.

Phone-first features: Lock Screen approvals with biometrics, push notifications, voice tasks, scheduled and queued runs, swipe-to-review diffs, one "needs you" inbox across all agents and machines.

## Architecture (planned)

```
Phone app  <--E2E encrypted-->  Relay (self-hostable)  <--E2E encrypted-->  Desktop bridge
                                                                              |- agent adapters (hooks / SDK / PTY)
                                                                              |- peek (screen capture, WebRTC)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/PRIOR_ART.md](docs/PRIOR_ART.md).

## Repo layout

| Path | Purpose |
|---|---|
| `apps/desktop-bridge` | Runs on your computer; adapts agents and talks to the relay |
| `apps/relay` | Small stateless forwarder; never sees content keys |
| `apps/mobile` | The phone app |
| `packages/protocol` | Shared message schema used by all three |
| `docs/` | Vision, architecture, roadmap, build prompt |

## Principles

- Open source (MIT). No telemetry, no account required.
- End-to-end encryption; the relay is untrusted and self-hostable.
- Every risky action needs an explicit tap. Never block the agent if the phone is unreachable.
- Phone first: if it is awkward on a phone, it is not done.

## Contributing

Open an issue to discuss before large changes. See [docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md) for the current build brief.

## License

MIT, see [LICENSE](LICENSE).
