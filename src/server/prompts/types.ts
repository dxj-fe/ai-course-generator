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

export type SpecialistPromptStatus = "active" | "draft";

export type SpecialistPromptLibraryEntry = {
  id:
    | "planner"
    | "pedagogy"
    | "story"
    | "visual"
    | "page-writer"
    | "image-prompt"
    | "html-engineer"
    | "qa"
    | "repair";
  agentName: string;
  status: SpecialistPromptStatus;
  outputSchema: string;
  moduleFile?: string;
  templateVariables: readonly string[];
  system: PromptTemplateDefinition;
  user: PromptTemplateDefinition;
};
