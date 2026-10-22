import { describe, expect, it } from "vitest";
import { generateRoomId, generatePairingSecret, joinToken } from "@pocketdeck/protocol/crypto";
import { RoomHub, type Conn, type HubConfig } from "../src/hub.js";

class Fake implements Conn {
  out: (string | Uint8Array)[] = [];
  closed = false;
  send(d: string | Uint8Array) { this.out.push(d); }
  close() { this.closed = true; }
  controls() { return this.out.filter((o): o is string => typeof o === "string").map((o) => JSON.parse(o)); }
  frames() { return this.out.filter((o): o is Uint8Array => typeof o !== "string"); }
}

const cfg = (over: Partial<HubConfig> = {}): HubConfig => ({ accessKeys: ["k1"], allowOpen: false, ...over });
const room = generateRoomId();
const token = joinToken(generatePairingSecret());
const join = (role: "pc" | "phone", over: object = {}) =>
  JSON.stringify({ t: "join", room, role, token, accessKey: "k1", ...over });

function connect(hub: RoomHub, role: "pc" | "phone", over: object = {}) {
  const c = new Fake();
  const s = hub.open(c);
  hub.message(s, join(role, over));
  return { c, s };
}

describe("RoomHub", () => {
  it("fails closed when unconfigured", () => {
    const hub = new RoomHub(cfg({ accessKeys: [] }));
    const { c } = connect(hub, "pc");
    expect(c.controls()).toEqual([{ t: "error", code: "unconfigured" }]);
    expect(c.closed).toBe(true);
    expect(hub.roomCount).toBe(0);
  });

  it("allows open access only when explicitly enabled", () => {
    const hub = new RoomHub(cfg({ accessKeys: [], allowOpen: true }));
    expect(connect(hub, "pc", { accessKey: undefined }).c.controls()[0]).toEqual({ t: "joined", peer: false });
  });

  it("rejects missing and wrong access keys", () => {
    const hub = new RoomHub(cfg());
    expect(connect(hub, "pc", { accessKey: undefined }).c.controls()[0].code).toBe("access_denied");
    expect(connect(hub, "pc", { accessKey: "nope" }).c.controls()[0].code).toBe("access_denied");
  });

  it("pairs pc and phone and forwards opaque frames both ways", () => {
    const hub = new RoomHub(cfg());
    const pc = connect(hub, "pc");
    const phone = connect(hub, "phone");
    expect(pc.c.controls()).toEqual([{ t: "joined", peer: false }, { t: "peer", online: true }]);
    expect(phone.c.controls()).toEqual([{ t: "joined", peer: true }]);
    hub.message(phone.s, Uint8Array.of(1, 2, 3));
    hub.message(pc.s, Uint8Array.of(9));
    expect(pc.c.frames()).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(phone.c.frames()).toEqual([Uint8Array.of(9)]);
  });

  it("drops frames when the peer is offline and announces departure", () => {
    const hub = new RoomHub(cfg());
    const pc = connect(hub, "pc");
    hub.message(pc.s, Uint8Array.of(1));
    const phone = connect(hub, "phone");
    hub.closed(phone.s);
    expect(pc.c.controls().at(-1)).toEqual({ t: "peer", online: false });
    expect(phone.c.frames()).toEqual([]);
  });

  it("rejects a different token for an existing room", () => {
    const hub = new RoomHub(cfg());
    connect(hub, "pc");
    const bad = connect(hub, "phone", { token: joinToken(generatePairingSecret()) });
    expect(bad.c.controls()[0].code).toBe("bad_token");
    expect(bad.c.closed).toBe(true);
  });

  it("replaces a stale connection of the same role on reconnect", () => {
    const hub = new RoomHub(cfg());
    const old = connect(hub, "pc");
    const phone = connect(hub, "phone");
    const fresh = connect(hub, "pc");
    expect(old.c.closed).toBe(true);
    hub.closed(old.s);
    hub.message(phone.s, Uint8Array.of(7));
    expect(fresh.c.frames()).toEqual([Uint8Array.of(7)]);
  });

  it("forgets empty rooms", () => {
    const hub = new RoomHub(cfg());
    const a = connect(hub, "pc");
    expect(hub.roomCount).toBe(1);
    hub.closed(a.s);
    expect(hub.roomCount).toBe(0);
  });

  it("rejects malformed joins, text after join and binary before join", () => {
    const hub = new RoomHub(cfg());
    for (const bad of ["not json", JSON.stringify({ t: "join" }), Uint8Array.of(1)]) {
      const c = new Fake();
      hub.message(hub.open(c), bad);
      expect(c.controls()[0].code).toBe("bad_join");
    }
    const pc = connect(hub, "pc");
    hub.message(pc.s, "hello");
    expect(pc.c.controls().at(-1).code).toBe("protocol");
  });

  it("enforces the frame size limit", () => {
    const hub = new RoomHub(cfg({ maxFrameBytes: 10 }));
    const c = new Fake();
    hub.message(hub.open(c), new Uint8Array(11));
    expect(c.controls()[0].code).toBe("frame_too_large");
    expect(c.closed).toBe(true);
  });

  it("rate limits with a refilling bucket", () => {
    let t = 0;
    const hub = new RoomHub(cfg({ ratePerSecond: 2, now: () => t }));
    const pc = connect(hub, "pc"); // uses 1 of 4 tokens
    hub.message(pc.s, Uint8Array.of(1));
    hub.message(pc.s, Uint8Array.of(1));
    hub.message(pc.s, Uint8Array.of(1));
    expect(pc.c.closed).toBe(false);
    t = 1000; // refills 2
    hub.message(pc.s, Uint8Array.of(1));
    expect(pc.c.closed).toBe(false);
    for (let i = 0; i < 5; i++) hub.message(pc.s, Uint8Array.of(1));
    expect(pc.c.controls().at(-1).code).toBe("rate_limited");
    expect(pc.c.closed).toBe(true);
  });
});
