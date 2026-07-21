import { describe, expect, it } from "vitest";

import {
  createCourseGraphCheckpointEnvelope,
  mapGraphChunkToAgentEvent,
} from "../../../../src/server/langgraph/course-generation/graph-stream-map";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

const traceId = "trace-day-30-stream";

describe("LangGraph stream product-event mapper", () => {
  it("maps custom checkpoints to ordered public events", () => {
    const state = createState(2);
    const mapped = mapGraphChunkToAgentEvent(
      ["custom", createCourseGraphCheckpointEnvelope(state)],
      { cursor: 0, traceId },
    );

    expect(mapped.state).toEqual(state);
    expect(mapped.events.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(mapped.cursor).toBe(2);
    expect(mapped.events.every((event) => !("data" in event))).toBe(true);
  });

  it("maps a known node update and deduplicates an observed sequence", () => {
    const mapped = mapGraphChunkToAgentEvent(
      ["updates", { "planner-node": createState(3) }],
      { cursor: 2, traceId },
    );

    expect(mapped.events).toHaveLength(1);
    expect(mapped.events[0]?.sequence).toBe(3);
    expect(mapped.cursor).toBe(3);
  });

  it("rejects unsupported modes, unknown nodes and private custom fields", () => {
    expect(() =>
      mapGraphChunkToAgentEvent(["debug", { private: true }], {
        cursor: 0,
        traceId,
      }),
    ).toThrow("mode 不允许");
    expect(() =>
      mapGraphChunkToAgentEvent(
        ["updates", { "private-node": createState(1) }],
        { cursor: 0, traceId },
      ),
    ).toThrow();
    expect(() =>
      mapGraphChunkToAgentEvent(
        [
          "custom",
          {
            ...createCourseGraphCheckpointEnvelope(createState(1)),
            data: { systemPrompt: "private" },
          },
        ],
        { cursor: 0, traceId },
      ),
    ).toThrow();
  });

  it("rejects sequence gaps and events from another trace", () => {
    const gap = createState(1);
    gap.events[0] = { ...gap.events[0]!, sequence: 2 };
    expect(() =>
      mapGraphChunkToAgentEvent(
        ["custom", createCourseGraphCheckpointEnvelope(gap)],
        { cursor: 0, traceId },
      ),
    ).toThrow("公开事件序号");

    const otherTrace = createState(1);
    otherTrace.events[0] = {
      ...otherTrace.events[0]!,
      traceId: "trace-private-run",
    };
    expect(() =>
      mapGraphChunkToAgentEvent(
        ["custom", createCourseGraphCheckpointEnvelope(otherTrace)],
        { cursor: 0, traceId },
      ),
    ).toThrow();
  });
});

function createState(eventCount: number): CourseGenerationState {
  return {
    version: 1,
    courseId: "course-day-30-stream",
    traceId,
    userPrompt: "生成五页太阳系课程",
    status: "running",
    currentStage: "planner",
    pages: [],
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `event-${index + 1}`,
      sequence: index + 1,
      type: index % 2 === 0 ? ("agent_start" as const) : ("agent_done" as const),
      traceId,
      timestamp: `2026-07-21T07:30:0${index}.000Z`,
      step: index + 1,
      summary: `公开事件 ${index + 1}`,
      stage: "planner" as const,
      agent: "planner",
    })),
    errors: [],
    startedAt: "2026-07-21T07:30:00.000Z",
    updatedAt: "2026-07-21T07:30:00.000Z",
  };
}
