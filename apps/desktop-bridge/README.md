# @pocketdeck/desktop-bridge

Runs on your computer. Receives Claude Code hook events over a local socket, keeps session state, and talks to the phone through the relay with end-to-end encryption.

```
npm run build -w @pocketdeck/desktop-bridge
node apps/desktop-bridge/dist/cli.js install-hooks     # shows a diff, makes a dated backup, asks first
node apps/desktop-bridge/dist/cli.js pair --relay ws://localhost:8787 --access-key <key>   # prints a QR code
node apps/desktop-bridge/dist/cli.js start
```

- **Hooks** (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`) all run `hook.js`. It exits 0 with no output if the bridge is down, so Claude Code is never blocked and falls back to its terminal prompt.
- **Approvals**: a `PermissionRequest` waits up to 2 minutes for the phone. A phone that is paired but offline gets a 25 s grace period (and a push) before the terminal takes over.
- **Instructions**: the phone's text runs `claude --resume <session> -p <text>` in the session's working directory (no shell, array args). Busy sessions are refused.
- **Keys** live in the OS keystore (`@napi-rs/keyring`). Without one, set `POCKETDECK_INSECURE_FILE_STORE=1` to use a 0600 file.
- State dir: `~/.pocketdeck` (`POCKETDECK_HOME` to override). Claude settings: `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR`).
- `POCKETDECK_CLAUDE_BIN` overrides the `claude` binary used for resuming.
