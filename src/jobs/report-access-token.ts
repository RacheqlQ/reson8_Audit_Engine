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
  let value = input.replace(/^["']+|["']+$/g, "");
  const beforeWhitespace = value.length;
  value = value.replace(/[\\s\\u200B-\\u200D\\uFEFF]/g, "");
  const whitespaceRemoved = beforeWhitespace - value.length;
  value = value.toLowerCase();
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
