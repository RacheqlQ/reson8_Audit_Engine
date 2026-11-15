import { findGenre, findScene, GENRE_TAXONOMY_VERSION, type GenreDefinition } from "./taxonomy.js";

export interface ProviderGenreTags {
  provider: string;
  tags: readonly string[];
}

export interface GenreCandidate {
  id: string;
  label: string;
  confidence: number;
  sources: string[];
}

export interface GenreFusionResult {
  taxonomyVersion: string;
  method: "weighted_provider_evidence_with_limited_tempo_prior";
  primaryGenre: string | null;
  genres: GenreCandidate[];
  confidence: number;
  abstained: boolean;
  regionTags: string[];
  sceneTags: string[];
  unmappedTags: Array<{ provider: string; tag: string }>;
  evidence: {
    providerWeightShare: number;
    tempoContributionCap: number;
    tempoUsed: boolean;
    providerCount: number;
  };
}

export interface GenreFusionInput {
  providerTags: readonly ProviderGenreTags[];
  bpm?: number | null;
  tempoConfidence?: number | null;
  regionTags?: readonly string[];
  sceneTags?: readonly string[];
  providerWeights?: Readonly<Record<string, number>>;
}

const PROVIDER_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  apple_music: 1, tidal: 1, deezer: 0.95, audiomack: 0.85,
  youtube_music: 0.8, audd: 0.7, id3: 0.45, musicbrainz: 0.8,
});
const TEMPO_WEIGHT_CAP = 0.15;
const MIN_PRIMARY_CONFIDENCE = 0.38;
const MIN_PRIMARY_MARGIN = 0.055;

function providerWeight(provider: string, overrides?: Readonly<Record<string, number>>): number {
  const configured = overrides?.[provider.toLowerCase()];
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) return configured;
  return PROVIDER_WEIGHTS[provider.toLowerCase()] ?? 0.65;
}

function tempoFit(genre: GenreDefinition, bpm: number | null, confidence: number): number {
  if (bpm === null || !Number.isFinite(bpm) || !genre.tempoHints) return 0;
  const [low, high] = genre.tempoHints;
  const distance = bpm < low ? low - bpm : bpm > high ? bpm - high : 0;
  const fit = distance === 0 ? 1 : Math.max(0, 1 - distance / Math.max(12, high - low));
  return fit * Math.max(0, Math.min(1, confidence));
}

export function fuseGenreEvidence(input: GenreFusionInput): GenreFusionResult {
  const votes = new Map<string, { genre: GenreDefinition; providers: Set<string>; weight: number }>();
  const unmappedTags: Array<{ provider: string; tag: string }> = [];
  const providerWeights = new Map<string, number>();
  const regionTags = new Set<string>();
  const sceneTags = new Set<string>();

  for (const source of input.providerTags) {
    const provider = source.provider.toLowerCase();
    const weight = providerWeight(provider, input.providerWeights);
    const normalizedTags = new Set(source.tags.map((tag) => tag.trim()).filter(Boolean));
    for (const tag of normalizedTags) {
      const genre = findGenre(tag);
      const scene = findScene(tag);
      if (scene) {
        if (scene.kind === "region") regionTags.add(scene.label);
        else sceneTags.add(scene.label);
      }
      if (!genre) {
        if (!scene) unmappedTags.push({ provider, tag });
        continue;
      }
      if (!providerWeights.has(provider)) providerWeights.set(provider, weight);
      const current = votes.get(genre.id) ?? { genre, providers: new Set<string>(), weight: 0 };
      if (!current.providers.has(provider)) {
        current.providers.add(provider);
        current.weight += weight;
      }
      votes.set(genre.id, current);
    }
  }

  for (const value of input.regionTags ?? []) {
    const scene = findScene(value);
    if (scene?.kind === "region") regionTags.add(scene.label);
  }
  for (const value of input.sceneTags ?? []) {
    const scene = findScene(value);
    if (scene && scene.kind !== "region") sceneTags.add(scene.label);
  }

  const totalProviderWeight = [...providerWeights.values()].reduce((sum, value) => sum + value, 0);
  const tempoConfidence = typeof input.tempoConfidence === "number" ? input.tempoConfidence : 0;
  const bpm = typeof input.bpm === "number" && Number.isFinite(input.bpm) ? input.bpm : null;
  const tempoUsed = bpm !== null && tempoConfidence > 0;
  const candidates = [...votes.values()].map(({ genre, providers, weight }) => {
    const providerScore = totalProviderWeight > 0 ? weight / totalProviderWeight : 0;
    const prior = tempoUsed ? tempoFit(genre, bpm, tempoConfidence) : 0;
    const score = providerScore * (tempoUsed ? 1 - TEMPO_WEIGHT_CAP : 1)
      + prior * (tempoUsed ? TEMPO_WEIGHT_CAP : 0);
    return { id: genre.id, label: genre.label, confidence: Math.max(0, Math.min(1, score)), sources: [...providers].sort() };
  }).sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));

  const first = candidates[0];
  const second = candidates[1];
  const margin = first ? first.confidence - (second?.confidence ?? 0) : 0;
  const abstained = !first || first.confidence < MIN_PRIMARY_CONFIDENCE || margin < MIN_PRIMARY_MARGIN;
  return {
    taxonomyVersion: GENRE_TAXONOMY_VERSION,
    method: "weighted_provider_evidence_with_limited_tempo_prior",
    primaryGenre: abstained ? null : first.label,
    genres: candidates.filter((candidate) => candidate.confidence >= 0.2).slice(0, 8),
    confidence: abstained ? first?.confidence ?? 0 : first.confidence,
    abstained,
    regionTags: [...regionTags].sort(),
    sceneTags: [...sceneTags].sort(),
    unmappedTags,
    evidence: {
      providerWeightShare: totalProviderWeight > 0 ? 1 - (tempoUsed ? TEMPO_WEIGHT_CAP : 0) : 0,
      tempoContributionCap: TEMPO_WEIGHT_CAP,
      tempoUsed,
      providerCount: providerWeights.size,
    },
  };
}
