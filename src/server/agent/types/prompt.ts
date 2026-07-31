import type { PromptId } from "@/server/agent/ids";

export type PromptDefinition = Readonly<{
  id: PromptId;
  description: string;
  templatePath: string;
  variables: readonly string[];
}>;
