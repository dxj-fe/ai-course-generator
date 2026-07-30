import { z } from "zod";

import { ArtifactRefSchema, type ArtifactRef } from "./course-artifact";

export const ToolFailureResultSchema = z
  .object({
    ok: z.literal(false),
    committed: z.literal(false),
    terminal: z.literal(false),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    feedback: z.array(z.string().min(1).max(1_000)).max(100).optional(),
  })
  .strict();

export function createToolSuccessResultSchema<T extends z.ZodType>(
  dataSchema: T,
) {
  return z
    .object({
      ok: z.literal(true),
      committed: z.boolean(),
      terminal: z.boolean(),
      summary: z.string().min(1).max(1_000),
      data: dataSchema,
      artifactRefs: z.array(ArtifactRefSchema).max(100).optional(),
    })
    .strict();
}

export function createToolResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.union([
    createToolSuccessResultSchema(dataSchema),
    ToolFailureResultSchema,
  ]);
}

export type ToolSuccessResult<T> = {
  ok: true;
  committed: boolean;
  terminal: boolean;
  summary: string;
  data: T;
  artifactRefs?: ArtifactRef[];
};

export type ToolFailureResult = z.infer<typeof ToolFailureResultSchema>;
export type ToolResult<T> = ToolSuccessResult<T> | ToolFailureResult;
