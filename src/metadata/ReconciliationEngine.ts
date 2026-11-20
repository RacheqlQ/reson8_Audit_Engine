import {
  MetadataEngine,
  type MetadataEngineInput,
  type TrackIdentity,
} from "./MetadataEngine.js";

export type ReconciliationStatus = "reconciled" | "conflict" | "partial";

export interface MetadataConflict {
  field: "title" | "artist" | "album" | "isrc" | "upc" | "label" | "releaseDate";
  values: readonly string[];
}

export interface MetadataReconciliation {
  status: ReconciliationStatus;
  identity: TrackIdentity;
  /** All matching provider fields, retained for compatibility. */
  reconciledFields: readonly string[];
  /** Recording-level fields independently corroborated by providers. */
  reconciledRecordingFields: readonly ("title" | "artist" | "isrc")[];
  /** Release-edition fields independently corroborated by providers. */
  releaseContextFields: readonly ("album" | "upc" | "label" | "releaseDate")[];
  /** Recording-level identity disagreements. */
  conflicts: readonly MetadataConflict[];
  /** Release-edition differences that do not imply different recordings. */
  releaseContextDifferences: readonly MetadataConflict[];
}

const PROVIDERS = ["spotify", "musicbrainz", "tidal", "apple_music", "deezer", "youtube_music", "audiomack", "audd", "id3"] as const;
const FIELDS = [
  "title",
  "artist",
  "album",
  "isrc",
  "upc",
  "label",
  "releaseDate",
] as const;
const RECORDING_FIELDS = new Set<string>(["title", "artist", "isrc"]);
const RELEASE_CONTEXT_FIELDS = new Set<string>(["album", "upc", "label", "releaseDate"]);

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeForComparison(
  field: (typeof FIELDS)[number],
  value: unknown,
): string | null {
  const normalized = clean(value);
  if (!normalized) return null;

  const canonical = normalized.normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (field === "isrc") {
    const isrc = canonical.replace(/[\s-]/g, "").toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc) ? isrc : null;
  }

  return canonical.toLowerCase();
}

function providerMetadata(
  input: MetadataEngineInput,
  provider: (typeof PROVIDERS)[number],
): Record<string, unknown> | null {
  const value = input[provider];
  if (!value) return null;
  if (provider === "audd" && "matched" in value && value.matched === false) return null;
  if (provider === "audd" && "result" in value && value.result) {
    return value.result as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export function reconcileMetadata(
  input: MetadataEngineInput,
): MetadataReconciliation {
  const identity = MetadataEngine.normalize(input);
  const reconciledFields: string[] = [];
  const reconciledRecordingFields: Array<"title" | "artist" | "isrc"> = [];
  const releaseContextFields: Array<"album" | "upc" | "label" | "releaseDate"> = [];
  const conflicts: MetadataConflict[] = [];
  const releaseContextDifferences: MetadataConflict[] = [];

  for (const field of FIELDS) {
    const claims = PROVIDERS
      .map((provider) => ({
        provider,
        value: normalizeForComparison(
          field,
          providerMetadata(input, provider)?.[field],
        ),
      }))
      .filter((claim): claim is { provider: typeof PROVIDERS[number]; value: string } =>
        Boolean(claim.value),
      );

    const uniqueValues = [...new Set(claims.map((claim) => claim.value))];

    if (uniqueValues.length >= 2) {
      const difference: MetadataConflict = {
        field,
        values: claims
          .filter((claim, index) => claims.findIndex((other) => other.value === claim.value) === index)
          .map((claim) => {
            const original = providerMetadata(input, claim.provider)?.[field];
            return clean(original) ?? claim.value;
          })
          .filter((value): value is string => Boolean(value)),
      };
      if (RELEASE_CONTEXT_FIELDS.has(field)) releaseContextDifferences.push(difference);
      else conflicts.push(difference);
      continue;
    }

    if (claims.length >= 2) {
      reconciledFields.push(field);
      if (RECORDING_FIELDS.has(field)) reconciledRecordingFields.push(field as "title" | "artist" | "isrc");
      if (RELEASE_CONTEXT_FIELDS.has(field)) releaseContextFields.push(field as "album" | "upc" | "label" | "releaseDate");
    }
  }

  const status: ReconciliationStatus =
    conflicts.length > 0
      ? "conflict"
      : reconciledFields.length > 0
        ? "reconciled"
        : "partial";

  return Object.freeze({
    status,
    identity,
    reconciledFields: Object.freeze(reconciledFields),
    reconciledRecordingFields: Object.freeze(reconciledRecordingFields),
    releaseContextFields: Object.freeze(releaseContextFields),
    conflicts: Object.freeze(conflicts.map((conflict) => Object.freeze({
      ...conflict,
      values: Object.freeze([...conflict.values]),
    }))),
    releaseContextDifferences: Object.freeze(releaseContextDifferences.map((difference) => Object.freeze({
      ...difference,
      values: Object.freeze([...difference.values]),
    }))),
  });
}
