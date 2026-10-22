import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { generatePairingSecret, generateRoomId, joinToken } from "@pocketdeck/protocol/crypto";
import { startRelay, type NodeRelay } from "../src/node.js";

let relay: NodeRelay | undefined;
afterEach(async () => { await relay?.close(); relay = undefined; });

function client(port: number, room: string): Promise<{ ws: WebSocket; msgs: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/${room}`);
    const msgs: unknown[] = [];
    ws.on("message", (d, bin) => msgs.push(bin ? new Uint8Array(d as Buffer) : JSON.parse(d.toString())));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("node relay", () => {
  it("serves health and forwards binary frames between roles", async () => {
    relay = await startRelay({ accessKeys: ["secret"], allowOpen: false }, 0);
    const port = (relay.server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    const room = generateRoomId();
    const token = joinToken(generatePairingSecret());
    const pc = await client(port, room);
    const phone = await client(port, room);
    pc.ws.send(JSON.stringify({ t: "join", room, role: "pc", token, accessKey: "secret" }));
    phone.ws.send(JSON.stringify({ t: "join", room, role: "phone", token, accessKey: "secret" }));
    await wait();
    phone.ws.send(Uint8Array.of(5, 6, 7));
    await wait();
    expect(pc.msgs.at(-1)).toEqual(Uint8Array.of(5, 6, 7));
    expect(phone.msgs[0]).toEqual({ t: "joined", peer: true });
    pc.ws.close(); phone.ws.close();
  });

  it("refuses everything when unconfigured and rejects oversize frames", async () => {
    relay = await startRelay({ accessKeys: [], allowOpen: false }, 0);
    const port = (relay.server.address() as { port: number }).port;
    const room = generateRoomId();
    const c = await client(port, room);
    c.ws.send(JSON.stringify({ t: "join", room, role: "pc", token: joinToken(generatePairingSecret()) }));
    await wait();
    expect(c.msgs[0]).toEqual({ t: "error", code: "unconfigured" });
    await relay.close();
    relay = await startRelay({ accessKeys: ["k"], allowOpen: false, maxFrameBytes: 100 }, 0);
    const p2 = (relay.server.address() as { port: number }).port;
    const big = await client(p2, room);
    const closed = new Promise((r) => big.ws.on("close", r));
    big.ws.send(new Uint8Array(500));
    await closed;
  });

  it("rejects upgrades on unknown paths", async () => {
    relay = await startRelay({ accessKeys: ["k"], allowOpen: false }, 0);
    const port = (relay.server.address() as { port: number }).port;
    await expect(new Promise((_, rej) => { const w = new WebSocket(`ws://127.0.0.1:${port}/nope`); w.on("error", rej); })).rejects.toBeTruthy();
  });
});
