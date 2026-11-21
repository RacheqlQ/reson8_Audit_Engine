const INTERNAL_LINE = /^(?:tempo method:|key method:|energy method:|assessment model provenance:|narrative field provenance:|worked example:|technical descriptors:|primary detector candidates:|alternate half\/double-time candidate:|independent low-frequency envelope estimate:|primary detector raw confidence|primary key raw confidence|primary tonal candidates:|segment agreement:|tuning offset:|independent goertzel estimate:|independent estimator disagreement:|relative major\/minor ambiguity detected|window stability:|beat grid:|tempo abstention:|key abstention \/ limitation:)/i;

function candidateNames(value: string): string[] {
  return value
    .replace(/\([^)]*\)/g, "")
    .split(/[,;]|\s+\/\s+/)
    .map(item => item.trim())
    .filter(item => /^[A-G](?:#|b)?\s+(?:major|minor)$/i.test(item));
}

export function sanitizePublicReportLine(value: string): string {
  const line = value.trim();
  if (!line || INTERNAL_LINE.test(line) || /\bconfidence.{0,30}\d/i.test(line) || /\bconfidence score\b/i.test(line)) return "";

  if (/^playlist discovery not run:/i.test(line)) return "Playlist research was not available because a recording code was not supplied.";
  if (/^required environment variables?:/i.test(line)) return "";
  if (/^.*provider unavailable:/i.test(line)) return "A music-platform search could not be completed.";

  const keyFinding = line.match(/^Not yet measured:\s*(.+?)\s*\(provisional harmonic candidate; alternatives:\s*(.*?);\s*no single key asserted\)\.?$/i);
  if (keyFinding) {
    const candidates = candidateNames([keyFinding[1]!, keyFinding[2]!].join(", ")).slice(0, 4);
    return candidates.length
      ? "Song key not confirmed. Possible tonal centres: " + candidates.join(", ") + "."
      : "Song key not confirmed. The recording did not provide a consistent tonal centre.";
  }

  if (/^(?:not yet measured:|not measured:).*?(?:key|tonal|harmonic)/i.test(line)) {
    return "Song key not confirmed. The recording did not provide a consistent tonal centre.";
  }

  let result = line
    .replace(/\b(?:high|medium|low)\s+confidence\b/gi, "")
    .replace(/\bconfidence[- ]qualified\b/gi, "")
    .replace(/\buploaded-master(?: tempo| harmonic| energy)? evidence\b/gi, "Measured from the uploaded recording")
    .replace(/\b(?:fft[_ -]?harmonic[_ -]?chroma[_ -]?ensemble|goertzel[_ -]?pitch[_ -]?frequency[_ -]?bank|high[_ -]?frequency[_ -]?transient[_ -]?autocorrelation)\b/gi, "")
    .replace(/\bDSPs?\b/gi, "music platform")
    .replace(/\bprovider(?:-recognized)?\b/gi, "platform")
    .replace(/\bmetadata\b/gi, "release details")
    .replace(/\bsource-attributed\b/gi, "source-backed")
    .replace(/\bprovenance\b/gi, "source")
    .replace(/\bgenre candidate\b/gi, "Genre direction")
    .replace(/\bN\/D\b/gi, "Not available")
    .replace(/\bhypothesis\b/gi, "working direction")
    .replace(/\bnot established\b/gi, "not confirmed")
    .replace(/\bnot cleared\b/gi, "pending checks")
    .replace(/\bharmonic\b/gi, "tonal")
    .replace(/\bprovisional\b/gi, "possible")
    .replace(/\bsegments?\b/gi, "sections")
    .replace(/\btechnical measurements\b/gi, "audio review")
    .replace(/\bintegrated loudness\b/gi, "overall playback level")
    .replace(/\btrue peak\b/gi, "peak level")
    .replace(/\bRMS signal level\b/gi, "signal level")
    .replace(/\b(?:RMS|spectral centroid|spectral bandwidth|spectral rolloff|zero-crossing rate|sample rate|dBFS|LUFS)\b/gi, "")
    .replace(/\bconfidence\b/gi, "")
    .replace(/\buploaded-master\b/gi, "uploaded recording")
    .replace(/\s*[·•]\s*/g, " · ")
    .replace(/\s{2,}/g, " ")
    .replace(/^(?:Not yet measured|Not measured):/i, "Not available:")
    .replace(/\s*·\s*(?:·\s*)+/g, " · ")
    .replace(/^\s*[·,;:-]+\s*|\s*[·,;:-]+\s*$/g, "")
    .trim();

  if (!result || /^[·,;:-]+$/.test(result)) return "";
  return result;
}

export function sanitizePublicReportLines(lines: string[]): string[] {
  return lines.map(sanitizePublicReportLine).filter(Boolean);
}
