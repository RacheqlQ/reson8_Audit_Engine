import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

type Runner = (args: string[], signal?: AbortSignal) => Promise<Uint8Array>;

export async function createRecognitionSample(
  master: Uint8Array,
  _mimeType: string,
  runner?: Runner,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-t",
    "30",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    "pipe:1",
  ];

  if (runner) {
    const result = await runner(args, signal);
    signal?.throwIfAborted();
    return result;
  }

  const binary = ffmpegPath as unknown as string | null;
  if (!binary) throw new Error("FFmpeg binary is unavailable");

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], signal });

    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Recognition sample extraction failed: ${stderr.trim() || `ffmpeg exited ${code}`}`));
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    ffmpeg.stdin.end(Buffer.from(master));
  });
}
