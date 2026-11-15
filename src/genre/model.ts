export interface GenreModelInput {
  bpm: number | null;
  tempoConfidence: number | null;
  key: string | null;
  mode: "major" | "minor" | null;
  providerGenreIds: readonly string[];
}

export interface GenreModelPrediction { genreId: string; confidence: number; }
export interface GenreModelResult { status: "disabled" | "available"; predictions: readonly GenreModelPrediction[]; }
export interface GenreModel { classify(input: GenreModelInput): Promise<GenreModelResult>; }

/** Safe default until licence, dataset, evaluation and enablement gates are satisfied. */
export class NullGenreModel implements GenreModel {
  async classify(_input: GenreModelInput): Promise<GenreModelResult> {
    return { status: "disabled", predictions: [] };
  }
}

export const DEFAULT_GENRE_MODEL: GenreModel = new NullGenreModel();