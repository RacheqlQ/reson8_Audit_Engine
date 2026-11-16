import { describe, expect, it } from "vitest";
import { sha256 } from "../src/jobs/content-hash.js";

describe("sha256", () => {
  it("returns a deterministic SHA-256 digest for uploaded bytes", async () => {
    await expect(sha256(new TextEncoder().encode("hello"))).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("produces different digests for different audio content", async () => {
    const first = await sha256(new Uint8Array([0, 1, 2]));
    const second = await sha256(new Uint8Array([0, 1, 3]));
    expect(first).not.toBe(second);
  });
});
