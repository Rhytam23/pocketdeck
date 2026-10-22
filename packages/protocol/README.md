# @pocketdeck/protocol

Shared message schemas (zod), approval binding and E2EE helpers used by the relay, bridge and phone.

- `@pocketdeck/protocol`: messages (`hello`, `welcome`, `sessions`, `event`, `approval`, `approvalResolved`, `decision`, `instruction`, `ping`, `pong`, `error`), the event vocabulary, approval hashing and rules.
- `@pocketdeck/protocol/crypto`: X25519 + HKDF-SHA256 + XChaCha20-Poly1305 channel, pairing QR payload.
- `@pocketdeck/protocol/relay`: the plaintext join frame the relay understands.

Test vectors live in `test/vectors.ts`; any other implementation must reproduce them.
