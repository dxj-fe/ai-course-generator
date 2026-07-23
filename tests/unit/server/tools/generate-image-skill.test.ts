import { describe, expect, it, vi } from "vitest";

import { createGenerateImageSkill } from "../../../../src/server/tools/generate-image-skill";
import type { AssetRequest } from "../../../../src/shared/course-schema";

const backgroundRequest: AssetRequest = {
  assetSlotId: "asset-slot-01",
  assetType: "background",
  usage: "课程标题背景",
  prompt: "A calm educational astronomy background with subtle stars and no text.",
  transparentBackground: false,
  safeArea: {
    position: "left",
    coveragePercent: 40,
    description: "为左侧 HTML 标题保留低细节区域。",
  },
  aspectRatio: "16:9",
};

function transparentPng() {
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, 320);
  new DataView(bytes.buffer).setUint32(20, 180);
  bytes[25] = 6;
  return bytes;
}

describe("generateImageSkill", () => {
  it("validates and stores a real raster result", async () => {
    const store = vi.fn().mockResolvedValue({
      id: "asset-123e4567-e89b-42d3-a456-426614174000",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
    });
    const skill = createGenerateImageSkill({
      generate: vi.fn().mockResolvedValue({
        bytes: transparentPng(),
        mediaType: "image/png",
        provider: "test-provider",
        model: "test-image-model",
      }),
      store,
    });
    const result = await skill.execute(
      {
        pageId: "page-02-knowledge",
        altText: "星空背景",
        request: backgroundRequest,
      },
      { traceId: "image-skill-ready" },
    );

    expect(result.status).toBe("ready");
    expect(result.asset).toMatchObject({
      mimeType: "image/png",
      dimensions: { width: 320, height: 180 },
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
    });
    expect(store).toHaveBeenCalledOnce();
  });

  it("returns an auditable fallback when generation fails", async () => {
    const skill = createGenerateImageSkill({
      generate: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      store: vi.fn(),
    });
    const result = await skill.execute(
      {
        pageId: "page-02-knowledge",
        altText: "星空背景",
        request: backgroundRequest,
      },
      { traceId: "image-skill-fallback" },
    );

    expect(result).toMatchObject({
      status: "fallback",
      fallback: { kind: "css-gradient" },
      errorCode: "IMAGE_GENERATION_FAILED",
    });
  });

  it("propagates cancellation instead of converting it into a fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const skill = createGenerateImageSkill({
      generate: vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
      store: vi.fn(),
    });

    await expect(
      skill.execute(
        {
          pageId: "page-02-knowledge",
          altText: "星空背景",
          request: backgroundRequest,
        },
        { abortSignal: controller.signal, traceId: "image-skill-aborted" },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps a usable Seedream JPEG and reports its missing transparency", async () => {
    const stickerRequest: AssetRequest = {
      ...backgroundRequest,
      assetSlotId: "asset-slot-02",
      assetType: "character_sticker",
      transparentBackground: true,
      safeArea: {
        position: "none",
        coveragePercent: 0,
        description: "独立贴纸不承载 HTML 文本。",
      },
      aspectRatio: "3:4",
    };
    const store = vi.fn().mockResolvedValue({
      id: "asset-123e4567-e89b-42d3-a456-426614174001",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174001",
    });
    const skill = createGenerateImageSkill({
      generate: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        mediaType: "image/jpeg",
        provider: "volcengine-ark",
        model: "test-image-model",
      }),
      store,
    });
    const result = await skill.execute(
      {
        pageId: "page-02-knowledge",
        altText: "小小宇航员",
        request: stickerRequest,
      },
      { traceId: "image-skill-transparent" },
    );

    expect(result).toMatchObject({
      status: "ready",
      asset: { mimeType: "image/jpeg" },
      warnings: ["TRANSPARENCY_UNAVAILABLE"],
    });
    expect(store).toHaveBeenCalledOnce();
  });
});
