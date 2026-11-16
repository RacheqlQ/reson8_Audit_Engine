import path from "node:path";

export const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/aac",
  "audio/ogg",
  "audio/mp4",
]);

export interface AudioUploadInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ValidatedAudioUpload {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export function validateAudioUpload(input: AudioUploadInput): ValidatedAudioUpload {
  const filename = path.basename(input.filename.trim());

  if (!filename || filename === "." || filename === "..") {
    throw new Error("Audio filename is required");
  }

  if (!SUPPORTED_MIME_TYPES.has(input.mimeType.toLowerCase())) {
    throw new Error("Unsupported audio type");
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("Audio file is empty");
  }

  if (input.sizeBytes > MAX_AUDIO_FILE_BYTES) {
    throw new Error("Audio file exceeds the 50 MB limit");
  }

  return {
    filename,
    mimeType: input.mimeType.toLowerCase(),
    sizeBytes: input.sizeBytes,
  };
}
