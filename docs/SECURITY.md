# Threat model (Stage 1)

Status: designed in good faith, **not independently audited**.

## What we protect

1. Content: prompts, commands, diffs, agent output. Must not be readable by the relay, a push provider, or a network attacker.
2. Control: only the paired phone can approve an action or send an instruction.
3. The agent's availability: PocketDeck being down, slow or attacked must never hang or break the agent.

## Actors

| Actor | Trust |
|---|---|
| Your computer and its logged-in user | Trusted. Any process running as you can talk to the bridge socket. |
| Your phone | Trusted after pairing. Allow needs biometrics or the screen lock. |
| Relay (yours or hosted) | **Untrusted.** Sees who connects, when, frame sizes. Never sees content or content keys. |
| Push provider (Expo/APNs/FCM) | Untrusted. Receives a device token and generic text only. |
| Network attacker | Untrusted. Sees TLS to the relay at best. |
| Someone who photographs the QR code | Can pair as the phone until you pair again. Treat the QR as a password. |

## Cryptography

No custom primitives. X25519 key agreement, HKDF-SHA256, XChaCha20-Poly1305, via the audited `@noble/*` libraries (see DECISIONS.md).

- Pairing: the bridge shows a QR with `{relay, room, bridge public key, 32-byte pairing secret}`. It is only ever displayed locally and scanned by the camera; it is never sent to the relay.
- Session keys: `HKDF(X25519(phone, bridge), salt = pairing secret)` gives one key per direction. A relay that records everything cannot derive them: it lacks the pairing secret and both private keys.
- The relay join token is `HKDF(pairing secret, "relay-join")`. It proves you know the secret without revealing anything usable for decryption. The relay stores only its SHA-256 per live room.
- Every frame is authenticated (AEAD) with a random 24-byte nonce. A counter inside the plaintext rejects replayed and reordered frames; counters are persisted on both sides so restarts do not reopen the replay window. Directional keys prevent reflecting a frame back.
- There is no forward secrecy beyond the pairing: compromise of both long-term keys exposes recorded traffic. A ratchet is future work.

## Approvals

- A request is identified by `SHA-256(canonical JSON{agent, sessionId, tool, command, requestId})` over the **full** command. The phone echoes the hash; the bridge accepts a decision only if request id and hash match a live request.
- Requests expire after 2 minutes. Late, unknown or mismatched decisions are ignored and reported back as an error.
- If the command was truncated for display (more than 2000 characters), Allow is disabled on the phone and also refused by the bridge. Deny always works.
- Allow carries `auth: biometric | screenlock`; the bridge refuses `none`. The phone only sets this after the OS prompt succeeds. A compromised phone could lie about this field, but a compromised phone is already trusted to approve.
- If the phone is unreachable the hook returns nothing and Claude Code asks in the terminal. A paired-but-offline phone gets a push and a 25 s grace period, never the full 2 minutes.

## Local attack surface

- Hook IPC is a Unix socket (named pipe on Windows) in `~/.pocketdeck`, directory mode 0700, socket 0600. Other users cannot connect; the same user can (accepted).
- Hook input is untrusted: parsed as JSON, validated by the adapter, never executed. Phone instructions are passed to `claude --resume` as an argument array, never through a shell.
- `~/.claude/settings.json` is only changed after showing a diff and confirming, with a dated backup, an atomic write, and only entries carrying the `--pocketdeck-hook` marker. Invalid JSON aborts without writing.
- Keys: bridge private key and pairing secret live in the OS keystore. A plain 0600 file is used only when you set `POCKETDECK_INSECURE_FILE_STORE=1`. Phone keys use `expo-secure-store` (this-device-only).

## Relay hardening

Fails closed without an access key; per-room token check; 256 KiB frame cap; per-connection rate limit; no storage or buffering; no logging of frames. It is a forwarder, so it can drop or delay traffic (denial of service), but not read or forge it.

## Known gaps and non-goals

- No third-party audit; no formal verification.
- No forward secrecy or key rotation yet; re-pair to rotate.
- One phone per computer.
- Metadata leaks to the relay: IP addresses, timing, sizes.
- Push provider learns that your device got a notification at a given time.
- A malicious process running as your user can read bridge memory or inject fake events and requests (it can also run the agent's commands directly).
- No telemetry, no account. If you add one downstream, that is outside this model.
