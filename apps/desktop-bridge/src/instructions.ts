import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface RunResult {
  code: number | null;
  stderr: string;
}

export type ResumeFn = (sessionId: string, cwd: string, text: string) => Promise<RunResult>;

/**
 * Resumes a Claude Code session in its working directory with the phone's text.
 * Arguments are passed as an array (no shell), so the text cannot inject commands.
 */
export function claudeResume(bin = process.env.POCKETDECK_CLAUDE_BIN ?? "claude"): ResumeFn {
  return async (sessionId, cwd, text) => {
    const s = await stat(cwd).catch(() => null);
    if (!s?.isDirectory()) return { code: null, stderr: `working directory not found: ${cwd}` };
    return new Promise((resolve) => {
      const child = spawn(bin, ["--resume", sessionId, "-p", text], { cwd, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
      child.on("error", (e) => resolve({ code: null, stderr: e.message }));
      child.on("close", (code) => resolve({ code, stderr }));
    });
  };
}
