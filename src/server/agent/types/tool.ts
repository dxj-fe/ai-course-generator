import type { ToolId } from "@/server/agent/ids";

export type ToolDefinition = Readonly<{
  id: ToolId;
  description: string;
  effect: "read" | "compute" | "write";
  terminal: boolean;
}>;
