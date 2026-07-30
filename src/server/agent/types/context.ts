import type { ContextId } from "@/server/agent/ids";

export type ContextDefinition = Readonly<{
  id: ContextId;
  description: string;
}>;
