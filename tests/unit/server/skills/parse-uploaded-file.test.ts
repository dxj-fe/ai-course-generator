import { describe, expect, it, vi } from "vitest";

import {
  chunkReferenceText,
  normalizeReferenceSummaryOutput,
  parseUploadedFileSkill,
} from "../../../../src/server/skills/parse-uploaded-file";

const summary = {
  summary: "资料解释太阳风。",
  keyFacts: [{ text: "太阳风包含带电粒子。", chunkIds: ["chunk-01"] }],
};

describe("parseUploadedFileSkill", () => {
  it("normalizes observed localized summary keys before strict validation", () => {
    expect(
      normalizeReferenceSummaryOutput({
        资料摘要: "资料解释太阳风。",
        关键事实: [
          { text: "太阳风包含带电粒子。", chunkIds: ["chunk-01"] },
        ],
      }),
    ).toEqual(summary);
  });

  it("keeps conflicting and unknown fields for the strict schema to reject", () => {
    const output = {
      summary: "规范字段。",
      资料摘要: "冲突字段。",
      keyFacts: [],
      extra: true,
    };

    expect(normalizeReferenceSummaryOutput(output)).toBe(output);
  });

  it("normalizes and chunks UTF-8 Markdown before summarizing", async () => {
    const summarize = vi.fn(async () => summary);
    const file = new File(
      ["# 太阳风\r\n\r\n太阳风包含带电粒子。\r\n"],
      "solar.md",
      { type: "text/markdown" },
    );

    const result = await parseUploadedFileSkill(
      file,
      { traceId: "trace-reference" },
      { summarize },
    );

    expect(result).toMatchObject({
      sourceName: "solar.md",
      sourceType: "md",
      summary: summary.summary,
      truncated: false,
    });
    expect(result.id).toMatch(/^ref-[a-f0-9]{24}$/);
    expect(result.chunks).toEqual([
      {
        id: "chunk-01",
        index: 1,
        text: "# 太阳风\n\n太阳风包含带电粒子。",
      },
    ]);
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        chunks: result.chunks,
        sourceName: "solar.md",
        traceId: "trace-reference",
      }),
    );
  });

  it("uses the PDF extractor only for a valid PDF header", async () => {
    const extractPdfText = vi.fn(async () => "太阳风由日冕释放。" );
    const result = await parseUploadedFileSkill(
      new File(["%PDF-1.7\nfixture"], "solar.pdf", {
        type: "application/pdf",
      }),
      { traceId: "trace-reference" },
      { extractPdfText, summarize: async () => summary },
    );

    expect(extractPdfText).toHaveBeenCalledOnce();
    expect(result.sourceType).toBe("pdf");
  });

  it("rejects unsupported, binary, oversized, and unextractable files", async () => {
    const context = { traceId: "trace-reference" };
    const summarize = async () => summary;

    await expect(
      parseUploadedFileSkill(
        new File(["hello"], "notes.docx"),
        context,
        { summarize },
      ),
    ).rejects.toThrow("仅支持 txt、md 和 pdf");
    await expect(
      parseUploadedFileSkill(
        new File([new Uint8Array([0, 1, 2])], "notes.txt", {
          type: "text/plain",
        }),
        context,
        { summarize },
      ),
    ).rejects.toThrow("包含二进制内容");
    await expect(
      parseUploadedFileSkill(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "notes.txt"),
        context,
        { summarize },
      ),
    ).rejects.toThrow("不能超过 5 MB");
    await expect(
      parseUploadedFileSkill(
        new File(["%PDF-1.7"], "scan.pdf", { type: "application/pdf" }),
        context,
        { extractPdfText: async () => "", summarize },
      ),
    ).rejects.toThrow("扫描件暂不支持 OCR");
  });

  it("caps chunk count and reports truncation", () => {
    const result = chunkReferenceText("段落 ".repeat(20_000));

    expect(result.chunks).toHaveLength(24);
    expect(result.chunks.every(({ text }) => text.length <= 1_500)).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("rejects model facts that reference unknown chunks", async () => {
    await expect(
      parseUploadedFileSkill(
        new File(["一份有效的资料正文。"], "notes.txt", {
          type: "text/plain",
        }),
        { traceId: "trace-reference" },
        {
          summarize: async () => ({
            summary: "无效引用。",
            keyFacts: [{ text: "虚构事实", chunkIds: ["chunk-02"] }],
          }),
        },
      ),
    ).rejects.toThrow("Reference Pack 校验失败");
  });
});
