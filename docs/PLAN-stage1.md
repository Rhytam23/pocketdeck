# Stage 0 + Stage 1 plan

Scope: Stage 0 (protocol, repo skeleton) and Stage 1 (Events MVP) from `ROADMAP.md`. No Peek, no cloud runner, no second agent adapter beyond Claude Code (the adapter interface is shaped so a second one is a small addition; see "Stubbed / deferred").

## Delivery order

One PR per package, stacked so each builds on the previous one.

| # | Branch | Package | Contents |
|---|---|---|---|
| 1 | `claude/blissful-hawking-b3ihko` | `packages/protocol` | Plan, decisions, workspace tooling, CI, message schemas, E2EE helpers, approval binding, test vectors |
| 2 | `...-relay` | `apps/relay` | Core room hub, Node server, Cloudflare Worker + Durable Object |
| 3 | `...-bridge` | `apps/desktop-bridge` | Claude Code hook installer and hook command, local IPC, approval and instruction flows, QR pairing, keystore |
| 4 | `...-mobile` | `apps/mobile` | Expo app, pairing, sessions, approvals, push, biometrics |
| 5 | `...-docs` | docs | SECURITY.md, getting started, demo script, README status |

Every package gets lint, typecheck and tests before each commit.

## Architecture decisions for this run

- **Wire layers.** (a) Relay envelope: tiny plaintext control frames (`join`, `joined`, `peer`, `error`) plus opaque binary frames. (b) Encrypted frame: `nonce || XChaCha20-Poly1305(ciphertext)` of a JSON protocol message. The relay only ever parses (a).
- **Pairing.** The bridge shows a QR holding `{relay, room, bridgePublicKey, pairingSecret}`. The phone makes an ephemeral X25519 key, derives per-direction session keys with HKDF over `DH(phone, bridge) || pairingSecret`, and authenticates its first frame with them. The relay never receives the QR contents. The relay join token is `HKDF(pairingSecret, "relay-join")`, so it cannot be turned into a content key.
- **Replay.** Each encrypted message carries a per-direction counter; the receiver rejects counters at or below the last seen.
- **Approval binding.** `SHA-256` over canonical JSON of `{agent, sessionId, tool, command, requestId}`. A decision must echo that hash, arrive before `expiresAt` (about 2 minutes), and match a still-pending request, else it is ignored.
- **Hook never blocks.** The hook command talks to the bridge over a Unix socket (named pipe on Windows). Any failure means exit 0 with no output, so Claude Code falls back to its terminal prompt.
- **Push.** The relay is stateless and blind, so the bridge sends a content-free push ("A session needs you") straight to the Expo push service using a token the phone sends over the encrypted channel.

See `DECISIONS.md` for library choices and reasons.

## Test strategy

- protocol: unit tests plus fixed test vectors (hashes, KDF output, canonical JSON, a full encrypted frame).
- relay: hub tests with fake sockets, plus an integration test against the real Node server using `ws`.
- bridge: adapter normalization, installer merge/backup/diff, IPC and approval timeout tests, plus an end-to-end test with a simulated phone peer over the real relay.
- mobile: pure logic (state reducer, session model, approval gating, pairing parse) tested with vitest; UI is typechecked only.

## Stubbed / deferred (to be reported honestly at the end)

- Anything needing a real phone: camera QR scan, biometrics, push delivery, one-handed layout check.
- Expo push credentials are not in the repo; push is wired but untested against Expo.
- Second agent: the adapter interface exists; only Claude Code is implemented.
- Cloudflare Worker is typechecked and its logic is shared with the tested core, but not deployed.
