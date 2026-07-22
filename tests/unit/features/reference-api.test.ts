import { afterEach, describe, expect, it, vi } from "vitest";

import { parseReferenceFile } from "../../../src/features/course-planner/lib/reference-api";

const pack = {
  version: 1,
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.txt",
  sourceType: "txt",
  byteSize: 20,
  summary: "太阳风资料。",
  keyFacts: [],
  chunks: [{ id: "chunk-01", index: 1, text: "太阳风由带电粒子构成。" }],
  truncated: false,
};

describe("reference API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads multipart data and validates the Reference Pack", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pack), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["太阳风由带电粒子构成。"], "solar.txt", {
      type: "text/plain",
    });

    await expect(
      parseReferenceFile(file, { traceId: "trace-reference" }),
    ).resolves.toEqual(pack);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/references/parse");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "x-trace-id": "trace-reference" });
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get("file")).toBe(file);
  });

  it("rejects invalid server payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...pack, chunks: [] }))),
    );

    await expect(
      parseReferenceFile(new File(["text"], "notes.txt")),
    ).rejects.toThrow("无效 Reference Pack");
  });
});
