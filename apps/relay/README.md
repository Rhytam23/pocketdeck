# @pocketdeck/relay

Blind WebSocket forwarder between exactly two roles (`pc`, `phone`) per room. It parses only the plaintext `join` frame and passes everything else through as opaque bytes. It never holds a content key: the join token is a one-way HKDF output of the pairing secret.

## Run (self-host, Node)

```
RELAY_ACCESS_KEYS=some-long-random-string npm run start -w @pocketdeck/relay
```

- Listens on `127.0.0.1:8787` (`HOST`, `PORT` to change). Clients connect to `/v1/<room>`.
- **Fails closed**: with no `RELAY_ACCESS_KEYS` it refuses every join. `RELAY_ALLOW_OPEN=1` opts out of the gate.
- Limits: 256 KiB per frame, 50 frames/s per connection (burst 100).
- Put TLS in front (Caddy, nginx) for `wss://`.

## Cloudflare

`wrangler.toml` defines a Durable Object per room. `wrangler secret put ACCESS_KEYS`, then `wrangler deploy`. Typechecked here, not deployed or load-tested.

## Notes

Rooms live only while a socket is connected; nothing is stored or buffered. A frame sent while the peer is offline is dropped, so the bridge re-sends state when it sees `peer online`.
