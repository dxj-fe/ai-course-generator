import type { ContextId } from "@/server/agent/ids";
import { DefinitionRegistry } from "@/server/agent/registry/definition-registry";
import type { ContextDefinition } from "@/server/agent/types/context";

export class ContextRegistry extends DefinitionRegistry<
  ContextId,
  ContextDefinition
> {
  constructor() {
    super("Context");
  }
}
