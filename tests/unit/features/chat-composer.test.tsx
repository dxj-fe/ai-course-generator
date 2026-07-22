import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "../../../src/features/seaca/chat-composer";

describe("ChatComposer", () => {
  it("renders the existing task parameters without moving planning rules into UI", () => {
    const markup = renderToStaticMarkup(
      <ChatComposer
        draft="生成课程"
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onTaskOptionsChange={vi.fn()}
        showSuggestions={false}
        taskOptions={{
          pageCount: 4,
          executionMode: "parallel",
          concurrency: 2,
        }}
      />,
    );

    expect(markup).toContain("生成参数");
    expect(markup).toContain("课程页数");
    expect(markup).toContain("执行方式");
    expect(markup).toContain("最大并发");
    expect(markup).toContain("4 页");
  });

  it("exposes an enabled cancel action while a course task is running", () => {
    const markup = renderToStaticMarkup(
      <ChatComposer
        busy
        draft="新的课程提示"
        onCancel={vi.fn()}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        showSuggestions={false}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="取消生成"');
    expect(markup).not.toMatch(/aria-label="取消生成"[^>]*disabled/);
    expect(markup).toContain('type="button"');
  });

  it("renders upload, retry, remove, and blocked-submit attachment states", () => {
    const markup = renderToStaticMarkup(
      <ChatComposer
        attachments={[
          {
            id: "reference-1",
            name: "solar.pdf",
            status: "error",
            error: "PDF 解析失败",
          },
        ]}
        draft="生成太阳风课程"
        onDraftChange={vi.fn()}
        onFilesSelected={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onSubmit={vi.fn()}
        showSuggestions={false}
      />,
    );

    expect(markup).toContain('accept=".txt,.md,.pdf');
    expect(markup).toContain("solar.pdf");
    expect(markup).toContain("解析失败");
    expect(markup).toContain("PDF 解析失败");
    expect(markup).toContain('aria-label="重试解析 solar.pdf"');
    expect(markup).toContain('aria-label="移除资料 solar.pdf"');
    expect(markup).toContain("请先重试或移除解析失败的资料");
    expect(markup).toMatch(/aria-label="发送"[^>]*disabled/);
  });

  it("shows a grounded preview and clear next action for a ready attachment", () => {
    const markup = renderToStaticMarkup(
      <ChatComposer
        attachments={[
          {
            id: "reference-ready",
            name: "solar-wind-reference.md",
            status: "ready",
            summary: "资料介绍太阳风、地球磁层和极光之间的关系。",
            keyFacts: [
              "太阳风主要由带电粒子组成。",
              "地球磁层会偏转大部分太阳风粒子。",
            ],
          },
        ]}
        draft=""
        onDraftChange={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSubmit={vi.fn()}
        showSuggestions={false}
      />,
    );

    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("解析完成");
    expect(markup).toContain("资料介绍太阳风、地球磁层和极光之间的关系");
    expect(markup).toContain("查看关键事实（2）");
    expect(markup).toContain("太阳风主要由带电粒子组成");
    expect(markup).toContain("资料已解析，请在下方填写学习目标并发送");
    expect(markup).toContain("描述要基于资料生成的课程");
    expect(markup).toMatch(/aria-label="发送"[^>]*disabled/);
  });
});
