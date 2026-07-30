import type { AgentId, SkillId } from "@/server/agent/ids";

export type SkillDiagnostic = Readonly<{
  level: "warning";
  code: string;
  message: string;
}>;

export type ProjectSkill = Readonly<{
  id: SkillId;
  name: string;
  description: string;
  logicalDir: string;
  logicalSkillFile: string;
  license?: string;
  compatibility?: string;
  metadata: Readonly<Record<string, string>>;
  resourcePaths: readonly string[];
  digest: string;
  diagnostics: readonly SkillDiagnostic[];
}>;

export type SkillCatalogEntry = Readonly<{
  name: SkillId;
  description: string;
  location: string;
  digest: string;
}>;

export type ResolvedSkillResource = Readonly<{
  skillId: SkillId;
  logicalPath: string;
  relativePath: string;
  absolutePath: string;
  absoluteSkillDir: string;
}>;

export type ReadLocalResourceGrant = Readonly<{
  agentId: AgentId;
  workOrderId: string;
  skillIds: readonly SkillId[];
  maxFileBytes: number;
  maxSessionBytes: number;
  maxReadCount: number;
  allowedMediaTypes: readonly string[];
}>;

export type LocalResourceReadRecord = Readonly<{
  agentId: AgentId;
  workOrderId: string;
  logicalPath: string;
  digest?: string;
  bytes?: number;
  result: "read" | "duplicate" | "denied";
  code?: string;
}>;

export type LoadedLocalResource = Readonly<{
  logicalPath: string;
  digest: string;
  content: string;
}>;
