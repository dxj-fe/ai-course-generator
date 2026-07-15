import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "../../../src/features/seaca/chat-composer";

describe("ChatComposer", () => {
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
});
