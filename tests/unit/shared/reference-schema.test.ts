import { describe, expect, it } from "vitest";

import {
  ReferencePackSchema,
  validateReferenceUsages,
} from "../../../src/shared/course-schema";

const pack = {
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.md",
  sourceType: "md" as const,
  byteSize: 120,
  summary: "资料介绍太阳风的来源。",
  keyFacts: [
    {
      text: "太阳风主要由带电粒子构成。",
      chunkIds: ["chunk-01"],
    },
  ],
  chunks: [{ id: "chunk-01", index: 1, text: "太阳风由带电粒子构成。" }],
  truncated: false,
};

describe("Reference Pack schema", () => {
  it("accepts traceable facts and page usages", () => {
    expect(ReferencePackSchema.parse(pack)).toEqual(pack);
    expect(
      validateReferenceUsages(
        [
          {
            referencePackId: pack.id,
            chunkIds: ["chunk-01"],
          },
        ],
        [pack],
      ),
    ).toEqual([]);
  });

  it("rejects facts and usages that invent chunk IDs", () => {
    expect(
      ReferencePackSchema.safeParse({
        ...pack,
        keyFacts: [{ text: "虚构事实", chunkIds: ["chunk-02"] }],
      }).success,
    ).toBe(false);
    expect(
      validateReferenceUsages(
        [
          {
            referencePackId: pack.id,
            chunkIds: ["chunk-02"],
          },
        ],
        [pack],
      ),
    ).toEqual([`资料 ${pack.id} 不包含 chunk-02`]);
  });
});
