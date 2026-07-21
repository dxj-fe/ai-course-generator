import { StateSchema } from "@langchain/langgraph";

import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

/**
 * 生产 Graph 直接复用 CourseGenerationState 的字段 Schema。Day 29 的顶层
 * 节点保持串行，数组字段由共享运行时返回完整快照，暂不引入第二套 Reducer。
 */
export const CourseGenerationGraphStateSchema = new StateSchema(
  CourseGenerationStateSchema.shape,
);

export type CourseGenerationGraphState =
  typeof CourseGenerationGraphStateSchema.State;
export type CourseGenerationGraphUpdate =
  typeof CourseGenerationGraphStateSchema.Update;
export type CourseGenerationGraphNode =
  typeof CourseGenerationGraphStateSchema.Node;

/** 每个节点更新后都恢复聚合 Schema 的跨字段校验。 */
export function parseCourseGenerationGraphState(
  state: CourseGenerationGraphState,
): CourseGenerationState {
  return CourseGenerationStateSchema.parse(state);
}

export function toCourseGenerationGraphUpdate(
  state: CourseGenerationState,
): CourseGenerationGraphUpdate {
  return state;
}
