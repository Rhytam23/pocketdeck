import { RoomHub, parseKeys, type ConnState } from "./hub.js";

interface Env {
  ROOM: DurableObjectNamespace;
  ACCESS_KEYS?: string;
  ALLOW_OPEN?: string;
}

const PATH = /^\/v1\/([A-Za-z0-9_-]{22,64})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    const m = PATH.exec(url.pathname);
    if (!m || req.headers.get("upgrade") !== "websocket") return new Response("not found", { status: 404 });
    // One Durable Object per room: the object holds the two sockets and nothing else.
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1] as string));
    return stub.fetch(req);
  },
};

export class Room {
  private readonly hub: RoomHub;

  constructor(_state: DurableObjectState, env: Env) {
    this.hub = new RoomHub({ accessKeys: parseKeys(env.ACCESS_KEYS), allowOpen: env.ALLOW_OPEN === "1" });
  }

  fetch(_req: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const state: ConnState = this.hub.open({
      send: (d) => server.send(d),
      close: () => server.close(),
    });
    server.addEventListener("message", (e) => {
      const d = e.data;
      this.hub.message(state, typeof d === "string" ? d : new Uint8Array(d as ArrayBuffer));
    });
    server.addEventListener("close", () => this.hub.closed(state));
    server.addEventListener("error", () => this.hub.closed(state));
    return new Response(null, { status: 101, webSocket: client });
  }
}
