import {
  MetadataEngine,
  type MetadataEngineInput,
  type TrackIdentity,
} from "./MetadataEngine.js";

export type ReconciliationStatus = "reconciled" | "conflict" | "partial";

export interface MetadataConflict {
  field: "title" | "artist" | "album" | "isrc" | "label" | "releaseDate";
  values: readonly string[];
}

export interface MetadataReconciliation {
  status: ReconciliationStatus;
  identity: TrackIdentity;
  reconciledFields: readonly string[];
  conflicts: readonly MetadataConflict[];
}

const PROVIDERS = ["spotify", "tidal", "apple_music", "deezer", "youtube_music", "audd", "id3"] as const;
const FIELDS = [
  "title",
  "artist",
  "album",
  "isrc",
  "label",
  "releaseDate",
] as const;

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

  if (field === "isrc") {
    return normalized.replace(/[\s-]/g, "").toUpperCase();
  }

  return normalized.toLocaleLowerCase();
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
  const conflicts: MetadataConflict[] = [];

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
      conflicts.push({
        field,
        values: claims.map((claim) => {
          const original = providerMetadata(input, claim.provider)?.[field];
          return clean(original) ?? claim.value;
        }).filter((value): value is string => Boolean(value)),
      });
      continue;
    }

    if (claims.length >= 2) {
      reconciledFields.push(field);
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
    conflicts: Object.freeze(conflicts.map((conflict) => Object.freeze({
      ...conflict,
      values: Object.freeze([...conflict.values]),
    }))),
  });
}
