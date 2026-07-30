import type { SchemaId } from "@/server/agent/ids";

export type SchemaDefinition = Readonly<{
  id: SchemaId;
  description: string;
}>;
