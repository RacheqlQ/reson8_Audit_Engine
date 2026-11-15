import { fuseGenreEvidence } from "../dist/genre/fusion.js";

const fixtures = [
  { provider: "apple_music", tags: ["Afrobeats"], expected: "Afrobeats" },
  { provider: "tidal", tags: ["Amapiano"], expected: "Amapiano" },
  { provider: "deezer", tags: ["Highlife"], expected: "Highlife" },
  { provider: "audiomack", tags: ["Alté"], expected: "Alté" },
  { provider: "musicbrainz", tags: ["Unmapped Experimental Label"], expected: null },
];
let correct = 0;
const outcomes = fixtures.map((fixture) => {
  const result = fuseGenreEvidence({ providerTags: [{ provider: fixture.provider, tags: fixture.tags }] });
  const passed = result.primaryGenre === fixture.expected;
  if (passed) correct++;
  return { expected: fixture.expected, actual: result.primaryGenre, abstained: result.abstained, passed };
});
console.log("[genre-evaluation:synthetic]", JSON.stringify({
  fixtures: fixtures.length,
  correct,
  accuracy: correct / fixtures.length,
  outcomes,
  realWorldAccuracyClaim: false,
}));
if (correct !== fixtures.length) process.exitCode = 1;
