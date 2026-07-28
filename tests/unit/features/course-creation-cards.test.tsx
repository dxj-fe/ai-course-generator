import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CourseBriefCard } from "../../../src/features/keya/course-creation-cards";
import { createCourseCreationBrief } from "../../../src/features/keya/course-creation-model";

describe("CourseBriefCard", () => {
  it("renders controlled selected states and leaves section planning to the backend", () => {
    const markup = renderToStaticMarkup(
      <CourseBriefCard
        brief={createCourseCreationBrief(
          "目标是理解太阳系，给初学者，讲解与互动结合",
        )}
        editing
        onAnswer={vi.fn()}
        onToggleEdit={vi.fn()}
      />,
    );

    expect(markup.match(/checked=""/g)).toHaveLength(2);
    expect(markup).toMatch(/checked=""[^>]*value="初学者"/);
    expect(markup).toMatch(/checked=""[^>]*value="mixed"/);
    expect(markup).toContain("由课芽按内容深度规划");
    expect(markup).not.toContain("课程节数</legend>");
    expect(markup).not.toContain(">3 节<");
    expect(markup).toContain("peer-checked:border-primary");
  });
});
