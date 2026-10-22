# Decisions

Format: decision, reason. Newest at the bottom.

1. **npm workspaces, TypeScript, vitest, ESLint (typescript-eslint).** Conventional, minimal, one install for every package.
2. **zod for schemas.** Runtime validation and inferred types from one source. JSON Schema can be generated from it later.
3. **Crypto: `@noble/curves`, `@noble/ciphers`, `@noble/hashes`.** Audited, pure JS, no native code, so the same code runs in Node, Workers and React Native (libsodium's WASM is awkward in React Native). Constructions are libsodium-style standards (X25519, HKDF-SHA256, XChaCha20-Poly1305), nothing invented.
4. **Crypto lives in `packages/protocol` (`@pocketdeck/protocol/crypto`).** Both ends must agree byte for byte, so one copy with shared test vectors beats a fifth package.
5. **Relay: one core, two shells.** `RoomHub` has no I/O dependencies; a Node `ws` server and a Cloudflare Durable Object both wrap it.
6. **Relay room authorization.** First joiner of a room registers `SHA-256(joinToken)`; later joiners must present the same token. The token is derived from the pairing secret and is useless for decryption.
7. **Keystore: `@napi-rs/keyring`** with a 0600 file fallback that must be opted into. Reason: needs to be the OS keystore by default without shelling out.
8. **QR: `qrcode` in the terminal on the bridge, `expo-camera` on the phone.**
9. **Push goes bridge to Expo directly with generic text.** Keeps the relay stateless and keeps content out of push providers.
10. **Hooks: `PermissionRequest` for approvals, other events fire-and-forget.** Hook timeout in settings is slightly above the approval expiry.
