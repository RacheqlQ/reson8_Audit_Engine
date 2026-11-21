import { sha256 } from "./content-hash.js";

export interface NormalizedReportAccessKey {
  value: string;
  suppliedLength: number;
  whitespaceRemoved: number;
  nonHexRemoved: number;
  valid: boolean;
}

export function normalizeReportAccessKey(input: string): NormalizedReportAccessKey {
  const suppliedLength = input.length;
  const withoutWhitespace = input.replace(/[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  const whitespaceRemoved = suppliedLength - withoutWhitespace.length;
  const value = withoutWhitespace.replace(/^["']+|["']+$/g, "").toLowerCase();
  const nonHexRemoved = (value.match(/[^0-9a-f]/g) ?? []).length;
  return {
    value,
    suppliedLength,
    whitespaceRemoved,
    nonHexRemoved,
    valid: /^[0-9a-f]{64}$/.test(value),
  };
}

export async function hashReportAccessKey(value: string): Promise<string> {
  return sha256(new TextEncoder().encode(value));
}
