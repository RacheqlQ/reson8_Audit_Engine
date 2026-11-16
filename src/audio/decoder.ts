import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

export interface AudioDecoder {
  decode(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedAudio>;
}

type FloatDecoder = (bytes: Uint8Array, signal?: AbortSignal) => Promise<Float32Array>;

export function createAudioDecoder(floatDecoder?: FloatDecoder): AudioDecoder {
  if (floatDecoder) {
    return {
      async decode(bytes, signal) {
        signal?.throwIfAborted();
        const samples = await floatDecoder(bytes, signal);
        signal?.throwIfAborted();
        return { samples, sampleRate: 44100, channels: 1 };
      },
    };
  }

  const binary = ffmpegPath as unknown as string | null;
  if (!binary) throw new Error("FFmpeg binary is unavailable");

  return {
    decode(bytes, signal) {
      return decodeWithFfmpeg(bytes, binary, signal);
    },
  };
}

async function decodeWithFfmpeg(bytes: Uint8Array, binary: string, signal?: AbortSignal): Promise<DecodedAudio> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(binary, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-f",
      "f32le",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"], signal });

    const chunks: Buffer[] = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Audio decode failed: ${stderr.trim() || `ffmpeg exited ${code}`}`));
        return;
      }

      const buffer = Buffer.concat(chunks);
      const aligned = buffer.subarray(0, buffer.byteLength - (buffer.byteLength % 4));
      const copied = new Float32Array(aligned.byteLength / 4);
      new Uint8Array(copied.buffer).set(aligned);
      resolve({
        samples: copied,
        sampleRate: 44100,
        channels: 1,
      });
    });

    ffmpeg.stdin.end(Buffer.from(bytes));
  });
}
