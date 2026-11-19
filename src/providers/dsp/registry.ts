import type { NormalizedDspTrackLink } from "./intake.js";
import { collectCatalogMetadata, type CatalogMetadata } from "./catalog.js";

export interface DspMetadataResult {
  link: NormalizedDspTrackLink;
  status: "recognized" | "partial" | "unavailable";
  metadata: CatalogMetadata | null;
  error: string | null;
}

export interface DspRegistryDependencies {
  collect?: (url: string, signal?: AbortSignal) => Promise<CatalogMetadata>;
  timeoutMs?: number;
}

export async function collectDspMetadata(
  links: readonly NormalizedDspTrackLink[],
  deps: DspRegistryDependencies = {},
  signal?: AbortSignal,
): Promise<DspMetadataResult[]> {
  const collect = deps.collect ?? collectCatalogMetadata;
  const timeoutMs = deps.timeoutMs ?? 12_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("DSP provider timeout must be a positive finite number");
  }

  const results: DspMetadataResult[] = [];
  for (const link of links) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    const providerSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const metadata = await collect(link.canonicalUrl, providerSignal);
      signal?.throwIfAborted();
      const policyFailure = metadata.raw?.providerPolicy;
      const policyUnavailable = Boolean(
        policyFailure && typeof policyFailure === "object"
        && (policyFailure as Record<string, unknown>).reason === "disabled by data policy",
      );
      const spotifyFailure = metadata.raw?.spotifyEnrichment;
      const spotifyUnavailable = Boolean(
        spotifyFailure && typeof spotifyFailure === "object"
        && (spotifyFailure as Record<string, unknown>).status === "unavailable",
      );
      const providerError = policyUnavailable
        ? "disabled by data policy"
        : spotifyUnavailable
          ? typeof (spotifyFailure as Record<string, unknown>).error === "string"
            ? (spotifyFailure as Record<string, unknown>).error as string
            : "Spotify API enrichment is unavailable"
          : null;
      // Capture retrieval time at the provider boundary, not later during report assembly.
      const retrievedAt = providerError ? undefined : new Date().toISOString();
      const retrievedMetadata = retrievedAt ? { ...metadata, retrievedAt } : metadata;
      results.push({
        link,
        status: policyUnavailable || spotifyUnavailable ? "unavailable" : metadata.evidenceStatus,
        metadata: retrievedMetadata,
        error: providerError,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("DSP lookup aborted");
      const timedOut = timeout.aborted;
      results.push({
        link,
        status: "unavailable",
        metadata: null,
        error: timedOut
          ? "Provider lookup timed out"
          : error instanceof Error ? error.message.slice(0, 240) : "Provider lookup failed",
      });
    }
  }
  return results;
}
