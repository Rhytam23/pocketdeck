import { chmod, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

export const MAX_IPC_LINE = 4 * 1024 * 1024;

export type IpcHandler = (req: unknown, onClose: (cb: () => void) => void) => Promise<unknown>;

/** Newline-delimited JSON over a Unix socket (named pipe on Windows). One request per connection. */
export async function serveIpc(path: string, handler: IpcHandler): Promise<Server> {
  if (process.platform !== "win32") {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await unlink(path).catch(() => undefined);
  }
  const server = createServer((sock) => {
    let buf = "";
    let handled = false;
    const closers: (() => void)[] = [];
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      if (handled) return;
      buf += chunk;
      if (buf.length > MAX_IPC_LINE) return void sock.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      handled = true;
      let req: unknown;
      try {
        req = JSON.parse(buf.slice(0, nl));
      } catch {
        return void sock.destroy();
      }
      handler(req, (cb) => closers.push(cb))
        .then((reply) => sock.end(JSON.stringify(reply ?? {}) + "\n"))
        .catch(() => sock.destroy());
    });
    sock.on("close", () => closers.forEach((cb) => cb()));
    sock.on("error", () => sock.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  if (process.platform !== "win32") await chmod(path, 0o600);
  return server;
}

/** Sends one request. Resolves with the reply, or null if `wait` is false. Rejects on any failure or timeout. */
export function requestIpc(path: string, req: unknown, opts: { wait: boolean; timeoutMs: number }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock: Socket = createConnection(path);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("ipc timeout"));
    }, opts.timeoutMs);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("error", (e) => done(() => reject(e)));
    sock.on("connect", () => {
      sock.write(JSON.stringify(req) + "\n", () => {
        if (!opts.wait) {
          sock.end();
          done(() => resolve(null));
        }
      });
    });
    sock.on("data", (c: string) => (buf += c));
    sock.on("end", () => {
      if (!opts.wait) return;
      try {
        done(() => resolve(JSON.parse(buf)));
      } catch (e) {
        done(() => reject(e));
      }
    });
  });
}
