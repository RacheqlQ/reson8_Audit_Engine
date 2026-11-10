import { describe, expect, it, vi } from "vitest";
import { AuddClient } from "../src/providers/audd/client.js";

describe("AuddClient", () => {
  it("posts the audio sample to AudD and requests reconciliation metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          result: {
            artist: "Tems",
            title: "Free Mind",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AuddClient("token-123");
    const result = await client.recognize(new Uint8Array([1, 2, 3]));

    expect(result).toEqual({
      matched: true,
      artist: "Tems",
      title: "Free Mind",
      rawResponse: { artist: "Tems", title: "Free Mind" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.audd.io/");
    expect(init.method).toBe("POST");

    const form = init.body as FormData;
    expect(form.get("api_token")).toBe("token-123");
    expect(form.get("return")).toBe("apple_music,spotify,deezer,musicbrainz");
    expect(form.get("file")).toBeInstanceOf(Blob);

    vi.unstubAllGlobals();
  });

  it("returns unmatched when AudD reports no result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "success", result: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(new AuddClient("token-123").recognize(new Uint8Array([1]))).resolves.toEqual({
      matched: false,
    });

    vi.unstubAllGlobals();
  });

  it("fails clearly when AudD returns a non-success HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream failure", { status: 502 })),
    );

    await expect(new AuddClient("token-123").recognize(new Uint8Array([1]))).rejects.toThrow(
      "AudD request failed with HTTP 502",
    );

    vi.unstubAllGlobals();
  });
});
