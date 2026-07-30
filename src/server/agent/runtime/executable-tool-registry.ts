import type { z } from "zod";

import { logToolCallEvent } from "./tool-call-event";
import type {
  ExecutableTool,
  ExecutableToolContext,
  ToolCallEventSink,
} from "./executable-tool";

type RegisteredExecutableTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  execute(
    input: unknown,
    context: ExecutableToolContext,
  ): Promise<unknown>;
};

export class ExecutableToolRegistry {
  private readonly tools = new Map<string, RegisteredExecutableTool>();

  constructor(
    private readonly eventSink: ToolCallEventSink = logToolCallEvent,
  ) {}

  register<TInput, TOutput>(
    tool: ExecutableTool<TInput, TOutput>,
  ) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool 已注册：${tool.name}`);
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as z.ZodType<unknown>,
      outputSchema: tool.outputSchema as z.ZodType<unknown>,
      execute: async (input, context) =>
        tool.execute(input as TInput, context),
    });

    return this;
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list() {
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
    context: ExecutableToolContext,
  ): Promise<TOutput> {
    const startedAt = Date.now();
    const tool = this.tools.get(name);

    try {
      if (!tool) {
        throw new Error(`Tool 不存在：${name}`);
      }

      const parsedInput = tool.inputSchema.safeParse(input);

      if (!parsedInput.success) {
        throw new Error(
          `Tool ${name} 输入校验失败：${formatZodIssues(parsedInput.error)}`,
        );
      }

      const output = await tool.execute(parsedInput.data, context);
      const parsedOutput = tool.outputSchema.safeParse(output);

      if (!parsedOutput.success) {
        throw new Error(
          `Tool ${name} 输出校验失败：${formatZodIssues(parsedOutput.error)}`,
        );
      }

      this.eventSink({
        event: "tool-call",
        traceId: context.traceId,
        toolName: name,
        input: parsedInput.data,
        output: parsedOutput.data,
        durationMs: Date.now() - startedAt,
        success: true,
      });

      return parsedOutput.data as TOutput;
    } catch (error) {
      this.eventSink({
        event: "tool-call",
        traceId: context.traceId,
        toolName: name,
        input,
        durationMs: Date.now() - startedAt,
        success: false,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }
}

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "root";

      return `${field}: ${issue.message}`;
    })
    .join("; ");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知 Tool 执行错误";
}
