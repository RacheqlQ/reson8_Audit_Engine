const INTERNAL_LINE = /^(?:tempo method:|key method:|energy method:|assessment model provenance:|narrative field provenance:|worked example:|technical descriptors:|primary detector raw confidence|primary key raw confidence|segment agreement:|tuning offset:|independent goertzel estimate:|independent estimator disagreement:|relative major\/minor ambiguity detected|window stability:|beat grid:|tempo abstention:|key abstention \/ limitation:)/i;

function candidateNames(value: string): string[] {
  return value
    .replace(/\([^)]*\)/g, "")
    .split(/[,;]|\s+\/\s+/)
    .map(item => item.trim())
    .filter(item => /^[A-G](?:#|b)?\s+(?:major|minor)$/i.test(item));
}

export function sanitizePublicReportLine(value: string): string {
  const line = value.trim();
  if (!line || INTERNAL_LINE.test(line) || /\\bconfidence\\b/i.test(line)) return "";

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
    .replace(/\bconfidence\s*[:=]?\s*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\braw confidence score\s*[:=]?\s*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\buploaded-master tempo evidence\b/gi, "Measured from the uploaded recording")
    .replace(/\buploaded-master harmonic evidence\b/gi, "Measured from the uploaded recording")
    .replace(/\buploaded-master energy evidence\b/gi, "Measured from the uploaded recording")
    .replace(/\bconfidence\b/gi, "")
    .replace(/\b(?:fft[_ -]?harmonic[_ -]?chroma[_ -]?ensemble|goertzel[_ -]?pitch[_ -]?frequency[_ -]?bank|high[_ -]?frequency[_ -]?transient[_ -]?autocorrelation)\b/gi, "")
    .replace(/\b(?:RMS|spectral centroid|spectral bandwidth|spectral rolloff|zero-crossing rate|sample rate|dBFS|LUFS)\b/gi, "")
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
