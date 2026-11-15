import { describe, expect, it } from "vitest";
import { fuseGenreEvidence } from "../src/genre/fusion.js";
import { findGenre, findScene, GENRE_TAXONOMY, GENRE_TAXONOMY_VERSION } from "../src/genre/taxonomy.js";

describe("versioned genre taxonomy", () => {
  it("includes African and Afro-diaspora genre depth", () => {
    const labels = new Set(GENRE_TAXONOMY.map((genre) => genre.label));
    for (const label of ["Afrobeats", "Alté", "Amapiano", "3-Step", "Gqom", "Highlife", "Hiplife", "Fuji", "Bongo Flava", "Singeli", "Kizomba"]) {
      expect(labels.has(label), label).toBe(true);
    }
    expect(GENRE_TAXONOMY_VERSION).toMatch(/^\d{4}\.\d+$/);
  });

  it("normalizes provider aliases without fuzzy guessing", () => {
    expect(findGenre("Afro Beats")?.id).toBe("afrobeats");
    expect(findGenre("Afro R&B")?.id).toBe("afro-rnb");
    expect(findGenre("Amapiano")?.id).toBe("amapiano");
    expect(findGenre("not-a-real-genre")).toBeNull();
    expect(findScene("Jozi")?.id).toBe("johannesburg");
  });
});

describe("genre evidence fusion", () => {
  it("uses provider genre tags as primary evidence and caps tempo at fifteen percent", () => {
    const result = fuseGenreEvidence({
      providerTags: [{ provider: "audiomack", tags: ["Afro Beats"] }],
      bpm: 112,
      tempoConfidence: 1,
    });
    expect(result.primaryGenre).toBe("Afrobeats");
    expect(result.evidence.tempoContributionCap).toBe(0.15);
    expect(result.evidence.providerWeightShare).toBe(0.85);
    expect(result.genres[0].sources).toEqual(["audiomack"]);
  });

  it("abstains when independent providers disagree", () => {
    const result = fuseGenreEvidence({
      providerTags: [
        { provider: "apple_music", tags: ["Amapiano"] },
        { provider: "tidal", tags: ["Highlife"] },
      ],
      bpm: 112,
      tempoConfidence: 0.9,
    });
    expect(result.primaryGenre).toBeNull();
    expect(result.abstained).toBe(true);
  });

  it("never invents a genre from tempo without provider genre evidence", () => {
    const result = fuseGenreEvidence({ providerTags: [], bpm: 112, tempoConfidence: 1 });
    expect(result.primaryGenre).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.abstained).toBe(true);
  });

  it("retains unmapped provider tags for audit without guessing a mapping", () => {
    const result = fuseGenreEvidence({
      providerTags: [{ provider: "deezer", tags: ["Afro Quantum Drill"] }],
    });
    expect(result.unmappedTags).toEqual([{ provider: "deezer", tag: "Afro Quantum Drill" }]);
    expect(result.primaryGenre).toBeNull();
  });

  it("keeps region and city-scene tags independent from genre labels", () => {
    const result = fuseGenreEvidence({
      providerTags: [{ provider: "tidal", tags: ["Afrobeats", "Lagos", "West Africa"] }],
    });
    expect(result.regionTags).toEqual(["West Africa"]);
    expect(result.sceneTags).toEqual(["Lagos"]);
    expect(result.primaryGenre).toBe("Afrobeats");
    expect(findScene("West Africa")?.kind).toBe("region");
  });

  it("emits a deterministic synthetic evaluation summary", () => {
    const fixtures = [
      { tags: ["Afrobeats"], expected: "Afrobeats" },
      { tags: ["Amapiano"], expected: "Amapiano" },
      { tags: ["Highlife"], expected: "Highlife" },
      { tags: ["Unknown Experimental Tag"], expected: null },
    ];
    let correct = 0;
    for (const fixture of fixtures) {
      const result = fuseGenreEvidence({ providerTags: [{ provider: "apple_music", tags: fixture.tags }] });
      if (result.primaryGenre === fixture.expected) correct++;
    }
    console.info("[genre-evaluation:synthetic]", JSON.stringify({ fixtures: fixtures.length, correct, accuracy: correct / fixtures.length, realWorldAccuracyClaim: false }));
    expect(correct).toBe(fixtures.length);
  });
});
