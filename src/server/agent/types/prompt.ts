import type { PromptId } from "@/server/agent/ids";

export type PromptDefinition = Readonly<{
  id: PromptId;
  version: number;
  description: string;
  templatePath: string;
  variables: readonly string[];
}>;
