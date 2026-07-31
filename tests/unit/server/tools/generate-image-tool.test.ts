import { describe, expect, it, vi } from "vitest";

import {
  buildImageGenerationProviderOptions,
  createGenerateImageTool,
} from "../../../../src/server/agent/plugins/tools/course/generate-image";
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

describe("generateImageTool", () => {
  it("requests Seedream Base64 output using the configured provider key", () => {
    expect(
      buildImageGenerationProviderOptions({
        apiKey: "test-key",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        modelName: "doubao-seedream-4-5-251128",
        providerName: "ark",
      }),
    ).toEqual({
      ark: {
        response_format: "b64_json",
        sequential_image_generation: "disabled",
        watermark: false,
      },
    });
    expect(
      buildImageGenerationProviderOptions({
        apiKey: "test-key",
        baseURL: "https://images.example.test/api",
        modelName: "custom-image-model",
        providerName: "custom-images",
      }),
    ).toBeUndefined();
  });

  it("validates and stores a real raster result", async () => {
    const store = vi.fn().mockResolvedValue({
      id: "asset-123e4567-e89b-42d3-a456-426614174000",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
    });
    const imageTool = createGenerateImageTool({
      generate: vi.fn().mockResolvedValue({
        bytes: transparentPng(),
        mediaType: "image/png",
        provider: "test-provider",
        model: "test-image-model",
      }),
      store,
    });
    const result = await imageTool.execute(
      {
        pageId: "page-02-knowledge",
        altText: "星空背景",
        request: backgroundRequest,
      },
      { traceId: "image-tool-ready" },
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
    const imageTool = createGenerateImageTool({
      generate: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      store: vi.fn(),
    });
    const result = await imageTool.execute(
      {
        pageId: "page-02-knowledge",
        altText: "星空背景",
        request: backgroundRequest,
      },
      { traceId: "image-tool-fallback" },
    );

    expect(result).toMatchObject({
      status: "fallback",
      fallback: { kind: "css-gradient" },
      errorCode: "IMAGE_GENERATION_FAILED",
    });
  });

  it("retries one provider timeout before using the deterministic fallback", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted due to timeout", "AbortError"),
      )
      .mockResolvedValueOnce({
        bytes: transparentPng(),
        mediaType: "image/png",
        provider: "test-provider",
        model: "test-image-model",
      });
    const store = vi.fn().mockResolvedValue({
      id: "asset-123e4567-e89b-42d3-a456-426614174010",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174010",
    });
    const imageTool = createGenerateImageTool({ generate, store });

    const result = await imageTool.execute(
      {
        pageId: "page-02-knowledge",
        altText: "星空背景",
        request: backgroundRequest,
      },
      { traceId: "image-tool-timeout-retry" },
    );

    expect(result.status).toBe("ready");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(store).toHaveBeenCalledOnce();
  });

  it("propagates cancellation instead of converting it into a fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const imageTool = createGenerateImageTool({
      generate: vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
      store: vi.fn(),
    });

    await expect(
      imageTool.execute(
        {
          pageId: "page-02-knowledge",
          altText: "星空背景",
          request: backgroundRequest,
        },
        { abortSignal: controller.signal, traceId: "image-tool-aborted" },
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
    const imageTool = createGenerateImageTool({
      generate: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        mediaType: "image/jpeg",
        provider: "volcengine-ark",
        model: "test-image-model",
      }),
      store,
    });
    const result = await imageTool.execute(
      {
        pageId: "page-02-knowledge",
        altText: "小小宇航员",
        request: stickerRequest,
      },
      { traceId: "image-tool-transparent" },
    );

    expect(result).toMatchObject({
      status: "ready",
      asset: { mimeType: "image/jpeg" },
      warnings: ["TRANSPARENCY_UNAVAILABLE"],
    });
    expect(store).toHaveBeenCalledOnce();
  });
});
