import { describe, expect, it, vi } from "vitest";

import {
  createImagePromptAgent,
  createImagePromptAgentState,
  resolveImagePromptInput,
  validateImagePromptOutput,
} from "../../../../src/server/agents/image-prompt-agent";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";

const contentWithFourAssetKinds = {
  ...pageContentDsl,
  assetSlots: [
    {
      id: "asset-slot-01" as const,
      type: "image" as const,
      role: "background" as const,
      purpose: "课程标题区的低细节星空背景",
      required: true,
      altTextGuidance: "柔和的星空背景",
    },
    {
      id: "asset-slot-02" as const,
      type: "illustration" as const,
      role: "inline" as const,
      purpose: "辅助解释恒星概念的角色贴纸",
      required: true,
      altTextGuidance: "观察恒星的小小宇航员",
    },
    {
      id: "asset-slot-03" as const,
      type: "icon" as const,
      role: "inline" as const,
      purpose: "标记重点知识的图标",
      required: false,
      altTextGuidance: "重点知识图标",
    },
    {
      id: "asset-slot-04" as const,
      type: "image" as const,
      role: "decorative" as const,
      purpose: "卡片边缘的微弱颗粒纹理",
      required: false,
      altTextGuidance: "装饰性颗粒纹理",
    },
  ],
};

describe("ImagePromptAgent", () => {
  it("covers background, character sticker, icon, and texture with production constraints", () => {
    const resolved = resolveImagePromptInput({
      content: contentWithFourAssetKinds,
      visualBrief,
    });
    const requests = validateImagePromptOutput(
      {
        directions: contentWithFourAssetKinds.assetSlots.map((slot) => ({
          assetSlotId: slot.id,
          promptCore: `A focused educational visual for ${slot.purpose}`,
          safeAreaPosition: slot.role === "background" ? "left" : "none",
        })),
      },
      resolved,
    );

    expect(requests.map(({ assetType }) => assetType)).toEqual([
      "background",
      "character_sticker",
      "icon",
      "texture",
    ]);
    expect(requests[0]).toMatchObject({
      aspectRatio: "16:9",
      transparentBackground: false,
      safeArea: { position: "left", coveragePercent: 40 },
    });
    expect(requests[1]).toMatchObject({
      aspectRatio: "3:4",
      transparentBackground: true,
    });
    expect(requests[2]).toMatchObject({
      aspectRatio: "1:1",
      transparentBackground: true,
    });
    expect(requests.every(({ prompt }) => prompt.includes("No text"))).toBe(true);
    expect(requests.every(({ prompt }) => prompt.includes("complete UI layouts"))).toBe(true);
    expect(requests.every(({ prompt }) => prompt.includes("No text or text-like marks"))).toBe(
      true,
    );
    expect(requests[0].prompt).toContain(
      "Do not draw a panel, card, sheet of paper",
    );
    expect(requests[0].prompt).toContain(
      "HTML content will be overlaid separately",
    );
    expect(requests[1].prompt).toContain(
      "do not add a presentation frame or surrounding layout",
    );
    expect(requests[0].prompt).toContain(
      "focal subject and its immediate context must fill 65–85%",
    );
    expect(requests[1].prompt).toContain(
      "single complete subject must fill 75–90%",
    );
    expect(requests[1].prompt).toContain(
      "never draw a checkerboard, transparency grid",
    );
    expect(requests[1].prompt).toContain(
      "Keep strict visual continuity with the rest of this course",
    );
    expect(requests[0].prompt).toContain("Course visual bible:");
    expect(requests[0].prompt).toContain(
      visualBrief.assetDirection.medium,
    );
    expect(requests[0].prompt).toContain("This page's composition:");
  });

  it("uses a wide scene request for an inline illustration unless the slot explicitly asks for a character sticker", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示猴王出世的情节时间线和花果山场景",
          required: true,
          altTextGuidance: "猴王出世的情节时间线",
        },
      ],
    };
    const requests = validateImagePromptOutput(
      {
        directions: [
          {
            assetSlotId: "asset-slot-01",
            promptCore: "A coherent educational story scene with one clear focal subject",
            safeAreaPosition: "none",
          },
        ],
      },
      resolveImagePromptInput({ content, visualBrief }),
    );

    expect(requests[0]).toMatchObject({
      assetType: "background",
      aspectRatio: "16:9",
      transparentBackground: false,
      safeArea: { position: "left", coveragePercent: 40 },
    });
    expect(requests[0].prompt).toContain("wide editorial scene illustration");
    expect(requests[0].prompt).toContain(
      "avoid a tiny, distant, icon-like, or isolated subject",
    );
  });

  it("keeps a detailed model direction after adding the production quality contract", () => {
    const resolved = resolveImagePromptInput({
      content: contentWithFourAssetKinds,
      visualBrief,
    });
    const requests = validateImagePromptOutput(
      {
        directions: contentWithFourAssetKinds.assetSlots.map((slot) => ({
          assetSlotId: slot.id,
          promptCore: `Detailed visual direction ${"with coherent educational details ".repeat(20)}`,
          safeAreaPosition: slot.role === "background" ? "left" : "none",
        })),
      },
      resolved,
    );

    expect(requests).toHaveLength(4);
    expect(Math.max(...requests.map(({ prompt }) => prompt.length))).toBeGreaterThan(
      1_800,
    );
  });

  it("skips the model when the page has no asset slots", async () => {
    const generateDirections = vi.fn();
    const state = await createImagePromptAgent({ generateDirections }).run(
      createImagePromptAgentState({ content: pageContentDsl, visualBrief }),
      { traceId: "image-prompt-empty" },
    );

    expect(state.status).toBe("completed");
    expect(state.requests).toEqual([]);
    expect(generateDirections).not.toHaveBeenCalled();
  });
});
