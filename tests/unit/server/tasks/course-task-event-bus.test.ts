import { describe, expect, it, vi } from "vitest";

import { createCourseTaskEventBus } from "../../../../src/server/course/task/event-bus";
import type { CourseTaskStreamMessage } from "../../../../src/shared/course-schema";

const timestamp = "2026-07-15T03:00:00.000Z";

function eventMessage(
  taskId: string,
  sequence: number,
): CourseTaskStreamMessage {
  return {
    type: "event",
    taskId,
    courseId: "course-fixture-19",
    event: {
      id: `event-${sequence}`,
      sequence,
      type: "agent_start",
      traceId: "trace-fixture-19",
      timestamp,
      step: sequence,
      summary: `event ${sequence}`,
      stage: "intent",
      agent: "intent",
    },
  };
}

describe("course task event bus", () => {
  it("isolates subscribers by task id and preserves publish order", () => {
    const bus = createCourseTaskEventBus();
    const firstTask: number[] = [];
    const otherTask: number[] = [];
    bus.subscribe("task-fixture-19", (message) => {
      if (message.type === "event") firstTask.push(message.event.sequence);
    });
    bus.subscribe("task-other", (message) => {
      if (message.type === "event") otherTask.push(message.event.sequence);
    });

    bus.publish(eventMessage("task-fixture-19", 1));
    bus.publish(eventMessage("task-other", 2));
    bus.publish(eventMessage("task-fixture-19", 3));

    expect(firstTask).toEqual([1, 3]);
    expect(otherTask).toEqual([2]);
  });

  it("returns an idempotent unsubscribe function", () => {
    const bus = createCourseTaskEventBus();
    const subscriber = vi.fn();
    const unsubscribe = bus.subscribe("task-fixture-19", subscriber);

    bus.publish(eventMessage("task-fixture-19", 1));
    unsubscribe();
    unsubscribe();
    bus.publish(eventMessage("task-fixture-19", 2));

    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it("uses a stable subscriber snapshot during publication", () => {
    const bus = createCourseTaskEventBus();
    const calls: string[] = [];
    let unsubscribeFirst: () => void = () => undefined;
    unsubscribeFirst = bus.subscribe("task-fixture-19", () => {
      calls.push("first");
      unsubscribeFirst();
    });
    bus.subscribe("task-fixture-19", () => calls.push("second"));

    bus.publish(eventMessage("task-fixture-19", 1));
    bus.publish(eventMessage("task-fixture-19", 2));

    expect(calls).toEqual(["first", "second", "second"]);
  });

  it("isolates a failing subscriber from the producer and other subscribers", () => {
    const bus = createCourseTaskEventBus();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const received: number[] = [];
    bus.subscribe("task-fixture-19", () => {
      throw new Error("connection already closed");
    });
    bus.subscribe("task-fixture-19", (message) => {
      if (message.type === "event") received.push(message.event.sequence);
    });

    expect(() => bus.publish(eventMessage("task-fixture-19", 1))).not.toThrow();
    expect(received).toEqual([1]);
    expect(consoleError).toHaveBeenCalledWith(
      "[course-task-event-bus] 事件订阅者处理失败",
      expect.objectContaining({ taskId: "task-fixture-19" }),
    );
    consoleError.mockRestore();
  });

  it("validates task ids and messages at the bus boundary", () => {
    const bus = createCourseTaskEventBus();

    expect(() => bus.subscribe("../outside", vi.fn())).toThrow();
    expect(() =>
      bus.publish({
        ...eventMessage("task-fixture-19", 1),
        data: { systemPrompt: "private" },
      } as unknown as CourseTaskStreamMessage),
    ).toThrow();
  });
});
