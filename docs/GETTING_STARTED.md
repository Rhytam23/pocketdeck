# Getting started

You need Node 22+, Claude Code, and a phone with Expo Go (or a dev build). Push notifications additionally need a dev build and an EAS project id; everything else works without them.

## 1. Install and test

```
npm install
npm run lint && npm run typecheck && npm test
npm run build -w @pocketdeck/desktop-bridge
```

## 2. Run a relay

```
export RELAY_ACCESS_KEYS=$(openssl rand -hex 16)
npm run start -w @pocketdeck/relay          # ws://127.0.0.1:8787
```

For a phone on another network, put the relay on a VPS behind TLS (Caddy or nginx) or deploy `apps/relay` to Cloudflare (see its README) and use the `wss://` URL. Keep the access key; you pass it to the bridge.

## 3. Install the hooks

```
node apps/desktop-bridge/dist/cli.js install-hooks
```

It prints a diff of `~/.claude/settings.json`, asks for confirmation, and writes a dated backup first. `uninstall-hooks` removes only PocketDeck's entries.

## 4. Pair

```
node apps/desktop-bridge/dist/cli.js pair --relay ws://<relay-host>:8787 --access-key "$RELAY_ACCESS_KEYS"
```

Start the app (`npm run start -w @pocketdeck/mobile`), open it on your phone, and scan the QR code. The terminal prints "paired". Next time just run `... cli.js start`.

If your OS has no keystore (headless Linux): `POCKETDECK_INSECURE_FILE_STORE=1`.

## 5. Try the round trip

1. In any project, run `claude`. The session appears on the phone.
2. Ask it to do something that needs permission (for example run a shell command). The phone shows an approval card; Allow asks for biometrics, Deny does not.
3. Type an instruction on the phone when the session is idle; the bridge resumes the session with it.

`scripts/demo.sh` runs steps 1-2 (relay and build) and prints the remaining commands with your values filled in.

## Troubleshooting

- Nothing shows on the phone: run `cli.js start` and watch for "phone online". Confirm the relay URL is reachable from the phone (use the computer's LAN IP, not `localhost`).
- Terminal approves instead of the phone: expected when the phone is offline; the hook never blocks.
- To undo everything: `uninstall-hooks`, delete `~/.pocketdeck`, remove the `pocketdeck` keystore entries.
