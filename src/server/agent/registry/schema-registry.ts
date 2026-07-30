import type { SchemaId } from "@/server/agent/ids";
import { DefinitionRegistry } from "@/server/agent/registry/definition-registry";
import type { SchemaDefinition } from "@/server/agent/types/schema";

export class SchemaRegistry extends DefinitionRegistry<
  SchemaId,
  SchemaDefinition
> {
  constructor() {
    super("Schema");
  }
}
