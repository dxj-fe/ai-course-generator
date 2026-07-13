export type PromptRole = "system" | "user";

export type PromptTemplate = {
  name: string;
  version: string;
  role: PromptRole;
  inputContract: readonly string[];
  outputContract: readonly string[];
  content: string;
};

export type PromptTemplateDefinition = Omit<PromptTemplate, "content"> & {
  fileName: string;
};
