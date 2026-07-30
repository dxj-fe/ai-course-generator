import type { ToolId } from "@/server/agent/ids";
import { DefinitionRegistry } from "@/server/agent/registry/definition-registry";
import type { ToolDefinition } from "@/server/agent/types/tool";

export class ToolRegistry extends DefinitionRegistry<
  ToolId,
  ToolDefinition
> {
  constructor() {
    super("Tool");
  }
}
