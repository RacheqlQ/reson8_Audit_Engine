export interface MusicBrainzReleaseEvidence {
  releaseId: string;
  title: string | null;
  date: string | null;
  label: string | null;
}

export interface MusicBrainzRecordingEvidence {
  recordingId: string;
  title: string | null;
  artist: string | null;
  releases: MusicBrainzReleaseEvidence[];
  source: "musicbrainz";
}

const API_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Reson8AuditEngine/1.0 (https://reson8-audit-engine.onrender.com)";
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

export function normalizeIsrc(value: string): string {
  const normalized = value.trim().replace(/[\s-]/g, "").toUpperCase();
  if (!ISRC_PATTERN.test(normalized)) {
    throw new Error("A valid 12-character ISRC is required");
  }
  return normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstLabel(release: Record<string, unknown>): string | null {
  const labelInfo = Array.isArray(release["label-info"]) ? release["label-info"] : [];
  for (const item of labelInfo) {
    if (!item || typeof item !== "object") continue;
    const label = (item as Record<string, unknown>).label;
    if (!label || typeof label !== "object") continue;
    const name = stringValue((label as Record<string, unknown>).name);
    if (name) return name;
  }
  return null;
}

function artistName(recording: Record<string, unknown>): string | null {
  const credits = Array.isArray(recording["artist-credit"]) ? recording["artist-credit"] : [];
  const names = credits.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const credit = entry as Record<string, unknown>;
    const name = stringValue(credit.name)
      ?? (credit.artist && typeof credit.artist === "object"
        ? stringValue((credit.artist as Record<string, unknown>).name)
        : null);
    return name ? [name] : [];
  });
  return names.length ? names.join("") : null;
}

function normalizeRecording(value: unknown): MusicBrainzRecordingEvidence | null {
  if (!value || typeof value !== "object") return null;
  const recording = value as Record<string, unknown>;
  const recordingId = stringValue(recording.id);
  if (!recordingId) return null;
  const releases = (Array.isArray(recording.releases) ? recording.releases : [])
    .flatMap((entry): MusicBrainzReleaseEvidence[] => {
      if (!entry || typeof entry !== "object") return [];
      const release = entry as Record<string, unknown>;
      const releaseId = stringValue(release.id);
      if (!releaseId) return [];
      return [{
        releaseId,
        title: stringValue(release.title),
        date: stringValue(release.date),
        label: firstLabel(release),
      }];
    });
  return {
    recordingId,
    title: stringValue(recording.title),
    artist: artistName(recording),
    releases,
    source: "musicbrainz",
  };
}

async function acquireRateLimitSlot(signal?: AbortSignal): Promise<void> {
  const previous = requestQueue;
  let release!: () => void;
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    signal?.throwIfAborted();
    const delay = Math.max(0, 1_000 - (Date.now() - lastRequestStartedAt));
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        const abort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new Error("MusicBrainz request aborted"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    signal?.throwIfAborted();
    lastRequestStartedAt = Date.now();
  } finally {
    release();
  }
}

export class MusicBrainzClient {
  async lookupIsrc(value: string, signal?: AbortSignal): Promise<MusicBrainzRecordingEvidence[]> {
    const isrc = normalizeIsrc(value);
    await acquireRateLimitSlot(signal);
    const url = new URL(`${API_BASE}/isrc/${encodeURIComponent(isrc)}`);
    url.searchParams.set("inc", "recordings+artist-credits+releases+labels");
    url.searchParams.set("fmt", "json");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`MusicBrainz ISRC lookup failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as { recordings?: unknown };
    if (!Array.isArray(payload.recordings)) return [];
    return payload.recordings
      .map(normalizeRecording)
      .filter((recording): recording is MusicBrainzRecordingEvidence => recording !== null);
  }
}
