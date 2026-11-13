import { normalizeAuddRecognition, type AuditRecognition } from "./normalize.js";

export interface AuddRecognitionClient {
  recognize(source: Uint8Array, signal?: AbortSignal): Promise<AuditRecognition>;
  recognizeUrl(url: string, signal?: AbortSignal): Promise<AuditRecognition>;
}

export class AuddClient implements AuddRecognitionClient {
  private readonly apiToken: string;
  constructor(apiToken = process.env.AUDD_API ?? process.env.AUDD_API_TOKEN) {
    if (!apiToken) throw new Error("AUDD_API is required");
    this.apiToken = apiToken;
  }
  private async request(fields: Record<string, string | Blob>, signal?: AbortSignal): Promise<AuditRecognition> {
    signal?.throwIfAborted();
    const form = new FormData();
    form.set("api_token", this.apiToken);
    form.set("return", "apple_music,spotify,deezer,musicbrainz");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const response = await fetch("https://api.audd.io/", { method: "POST", body: form, signal });
    if (!response.ok) throw new Error(`AudD request failed with HTTP ${response.status}`);
    const payload = (await response.json()) as { status?: string; error?: { error_message?: string }; result?: unknown };
    if (payload.status === "error" || payload.error) throw new Error(payload.error?.error_message ?? "AudD recognition failed");
    const normalized = normalizeAuddRecognition(
      (payload.result ?? null) as Parameters<typeof normalizeAuddRecognition>[0],
    );
    if (!normalized.matched) {
      return {
        matched: false,
        rawResponse: { status: payload.status ?? null, result: payload.result ?? null },
      };
    }
    return normalized;
  }
  async recognize(source: Uint8Array, signal?: AbortSignal): Promise<AuditRecognition> {
    const bytes = new Uint8Array(source.byteLength); bytes.set(source);
    return this.request({ file: new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }) }, signal);
  }
  async recognizeUrl(url: string, signal?: AbortSignal): Promise<AuditRecognition> { return this.request({ url }, signal); }
}
