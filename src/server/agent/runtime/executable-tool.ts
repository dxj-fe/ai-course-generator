import type { z } from "zod";

export type ExecutableToolContext = {
  abortSignal?: AbortSignal;
  traceId: string;
};

export type ExecutableTool<TInput, TOutput> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(
    input: TInput,
    context: ExecutableToolContext,
  ): Promise<TOutput> | TOutput;
};

export type ToolCallEvent = {
  event: "tool-call";
  traceId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
};

export type ToolCallEventSink = (event: ToolCallEvent) => void;
