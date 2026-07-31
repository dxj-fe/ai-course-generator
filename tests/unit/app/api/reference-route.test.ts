import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parseReferenceUpload: vi.fn() }));

vi.mock("@/server/reference/parse", () => ({
  parseReferenceUpload: mocks.parseReferenceUpload,
}));

import { POST } from "../../../../src/app/api/references/parse/route";

const pack = {
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.txt",
  sourceType: "txt",
  byteSize: 20,
  summary: "太阳风资料。",
  keyFacts: [],
  chunks: [{ id: "chunk-01", index: 1, text: "太阳风包含带电粒子。" }],
  truncated: false,
};

describe("reference parse Route Handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses a multipart file and keeps the trace boundary", async () => {
    mocks.parseReferenceUpload.mockResolvedValue(pack);
    const formData = new FormData();
    const file = new File(["太阳风包含带电粒子。"], "solar.txt", {
      type: "text/plain",
    });
    formData.set("file", file);

    const response = await POST(
      new Request("http://localhost/api/references/parse", {
        method: "POST",
        headers: { "x-trace-id": "trace-reference-route" },
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pack);
    expect(mocks.parseReferenceUpload).toHaveBeenCalledWith(
      expect.objectContaining({ name: "solar.txt" }),
      { traceId: "trace-reference-route" },
    );
  });

  it("rejects a request without the file field", async () => {
    const response = await POST(
      new Request("http://localhost/api/references/parse", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "multipart/form-data 必须包含 file 字段。",
    });
    expect(mocks.parseReferenceUpload).not.toHaveBeenCalled();
  });
});
