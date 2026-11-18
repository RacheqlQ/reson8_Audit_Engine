import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  loudnessLufs?: number | null;
  loudnessRangeLu?: number | null;
  truePeakDbfs?: number | null;
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
        return { samples, sampleRate: 44100, channels: 1, loudnessLufs: null, loudnessRangeLu: null, truePeakDbfs: null };
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

/** Decode FFmpeg's float WAV without forcing mono or resampling: the header is the source of truth. */
export function parseFloatPcmWav(buffer: Buffer): Pick<DecodedAudio, "samples" | "sampleRate" | "channels"> {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("FFmpeg did not return a valid RIFF/WAVE stream");
  }
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const declaredSize = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const available = Math.max(0, buffer.length - start);
    const size = Math.min(declaredSize === 0xffffffff ? available : declaredSize, available);
    if (id === "fmt " && size >= 16) {
      format = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
      if (format === 0xfffe && size >= 40) format = buffer.readUInt16LE(start + 24);
    } else if (id === "data") {
      dataOffset = start;
      dataLength = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (format !== 3 || bitsPerSample !== 32 || channels < 1 || sampleRate < 1 || dataOffset < 0) {
    throw new Error("Unsupported FFmpeg WAV format; expected interleaved 32-bit float PCM");
  }
  const alignedLength = dataLength - (dataLength % 4);
  const samples = new Float32Array(alignedLength / 4);
  for (let index = 0; index < samples.length; index++) samples[index] = buffer.readFloatLE(dataOffset + index * 4);
  if (samples.length % channels !== 0) throw new Error("Decoded PCM frame is incomplete");
  return { samples, sampleRate, channels };
}

export function parseEbur128Summary(stderr: string): Pick<DecodedAudio, "loudnessLufs" | "loudnessRangeLu" | "truePeakDbfs"> {
  const finite = (value: string | undefined): number | null => {
    if (!value || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const integrated = finite(stderr.match(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i)?.[1]);
  const range = finite(stderr.match(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU\b/i)?.[1]);
  const truePeakSection = stderr.match(/True peak:[\s\S]*?(?=\n\s*\n|$)/i)?.[0] ?? "";
  const peaks = [...truePeakSection.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/gi)]
    .map((match) => Number(match[1])).filter(Number.isFinite);
  return {
    loudnessLufs: integrated,
    loudnessRangeLu: range,
    truePeakDbfs: peaks.length ? Math.max(...peaks) : null,
  };
}

async function decodeWithFfmpeg(bytes: Uint8Array, binary: string, signal?: AbortSignal): Promise<DecodedAudio> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(binary, [
      "-hide_banner", "-nostats", "-loglevel", "info", "-i", "pipe:0", "-vn",
      "-af", "ebur128=peak=true", "-c:a", "pcm_f32le", "-f", "wav", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"], signal });

    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Audio decode failed: ${stderr.trim() || `ffmpeg exited ${code}`}`));
        return;
      }
      try {
        const decoded = parseFloatPcmWav(Buffer.concat(chunks));
        resolve({ ...decoded, ...parseEbur128Summary(stderr) });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Audio decode output could not be parsed"));
      }
    });
    ffmpeg.stdin.end(Buffer.from(bytes));
  });
}
