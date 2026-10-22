#!/usr/bin/env -S npx tsx
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_FRAME_BYTES } from "@pocketdeck/protocol/relay";
import { RoomHub, parseKeys, type HubConfig } from "./hub.js";

export interface NodeRelay {
  server: Server;
  hub: RoomHub;
  close(): Promise<void>;
}

const PATH = /^\/v1\/[A-Za-z0-9_-]{22,64}$/;

export function startRelay(cfg: HubConfig, port: number, host = "127.0.0.1"): Promise<NodeRelay> {
  const hub = new RoomHub(cfg);
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    } else {
      res.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.maxFrameBytes ?? MAX_FRAME_BYTES });
  server.on("upgrade", (req, socket, head) => {
    if (!PATH.test((req.url ?? "").split("?")[0] ?? "")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(hub, ws));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () =>
      resolve({
        server,
        hub,
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      }),
    );
  });
}

function attach(hub: RoomHub, ws: WebSocket): void {
  const state = hub.open({
    send: (d) => ws.send(d),
    close: () => ws.close(),
  });
  ws.on("message", (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    hub.message(state, isBinary ? new Uint8Array(buf) : buf.toString("utf8"));
  });
  ws.on("close", () => hub.closed(state));
  ws.on("error", () => hub.closed(state));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const accessKeys = parseKeys(process.env.RELAY_ACCESS_KEYS);
  const allowOpen = process.env.RELAY_ALLOW_OPEN === "1";
  if (accessKeys.length === 0 && !allowOpen) {
    console.error(
      "pocketdeck-relay: no RELAY_ACCESS_KEYS set. The relay will refuse every connection.\n" +
        "Set RELAY_ACCESS_KEYS=<key>[,<key>] or RELAY_ALLOW_OPEN=1 to run without a gate.",
    );
  }
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const relay = await startRelay({ accessKeys, allowOpen }, port, host);
  console.log(`pocketdeck-relay listening on ${host}:${port}`);
  process.on("SIGINT", () => void relay.close().then(() => process.exit(0)));
}
