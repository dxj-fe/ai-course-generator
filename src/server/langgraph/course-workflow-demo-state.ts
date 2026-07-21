import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const LangGraphDemoEventSchema = z
  .object({
    node: z.enum(["start", "planner"]),
    summary: z.string().min(1).max(200),
  })
  .strict();

export type LangGraphDemoEvent = z.infer<
  typeof LangGraphDemoEventSchema
>;

const LangGraphDemoEventsSchema = z
  .array(LangGraphDemoEventSchema)
  .max(20)
  .default(() => []);

/**
 * Day 28 独立学习状态：普通字段采用覆盖语义，events 通过 Reducer 累计。
 * 它只映射生产 CourseGenerationState 的关键概念，不参与实际课程生成。
 */
export const CourseWorkflowDemoStateSchema = new StateSchema({
  prompt: z.string().trim().min(2).max(4_000),
  plan: z.array(z.string().min(1).max(200)).max(5).default(() => []),
  events: new ReducedValue(LangGraphDemoEventsSchema, {
    reducer: (
      current: LangGraphDemoEvent[],
      incoming: LangGraphDemoEvent[],
    ) => [...current, ...incoming],
  }),
});

export type CourseWorkflowDemoState =
  typeof CourseWorkflowDemoStateSchema.State;
