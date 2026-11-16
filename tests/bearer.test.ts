import { describe, expect, it } from "vitest";
import { extractBearerToken } from "../src/auth/bearer.js";

describe("extractBearerToken", () => {
  it("extracts a bearer token case-insensitively", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });

  it("rejects missing and malformed authorization headers", () => {
    expect(() => extractBearerToken(undefined)).toThrow("Authorization token is required");
    expect(() => extractBearerToken("Basic abc123")).toThrow("Authorization token is required");
    expect(() => extractBearerToken("Bearer")).toThrow("Authorization token is required");
  });
});
