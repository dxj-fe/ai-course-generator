import path from "node:path";

import type { SkillId } from "@/server/agent/ids";
import {
  discoverProjectSkills,
  type DiscoveredProjectSkill,
} from "@/server/agent/skill/discover";
import { AgentResourceError } from "@/server/agent/skill/errors";
import {
  buildSkillLogicalPath,
  parseAgentResourcePath,
} from "@/server/agent/skill/path";
import type {
  ProjectSkill,
  ResolvedSkillResource,
  SkillCatalogEntry,
} from "@/server/agent/skill/types";

export class SkillRegistry {
  readonly #skillRoot: string;
  readonly #declaredIds: ReadonlySet<SkillId>;
  readonly #skills = new Map<SkillId, DiscoveredProjectSkill>();
  #initialized = false;

  constructor(input: {
    skillRoot: string;
    declaredIds: readonly SkillId[];
  }) {
    this.#skillRoot = input.skillRoot;
    this.#declaredIds = new Set(input.declaredIds);
    if (this.#declaredIds.size !== input.declaredIds.length) {
      throw new AgentResourceError(
        "SKILL_ID_DUPLICATE",
        "SkillIds 不能包含重复值。",
      );
    }
  }

  async initialize() {
    if (this.#initialized) return this;

    const discovered = await discoverProjectSkills(this.#skillRoot);
    const discoveredNames = new Set(discovered.map(({ name }) => name));

    for (const id of this.#declaredIds) {
      if (!discoveredNames.has(id)) {
        throw new AgentResourceError(
          "SKILL_RESOURCE_MISSING",
          `SkillIds.${id} 没有对应的项目资源目录。`,
        );
      }
    }
    for (const skill of discovered) {
      if (!this.#declaredIds.has(skill.name as SkillId)) {
        throw new AgentResourceError(
          "SKILL_ID_UNDECLARED",
          `资源目录 ${skill.name} 未在 SkillIds 中声明。`,
        );
      }
      this.#skills.set(skill.name as SkillId, skill);
    }

    this.#initialized = true;
    return this;
  }

  get(id: SkillId): ProjectSkill {
    const skill = this.getInternal(id);
    return toProjectSkill(id, skill);
  }

  list() {
    this.assertInitialized();
    return Object.freeze(
      [...this.#skills.entries()].map(([id, skill]) =>
        toProjectSkill(id, skill),
      ),
    );
  }

  catalog(ids: readonly SkillId[]): readonly SkillCatalogEntry[] {
    return Object.freeze(
      ids.map((id) => {
        const skill = this.get(id);
        return Object.freeze({
          name: skill.id,
          description: skill.description,
          location: skill.logicalSkillFile,
          digest: skill.digest,
        });
      }),
    );
  }

  resolve(
    id: SkillId,
    relativePath: string,
  ): ResolvedSkillResource {
    const skill = this.getInternal(id);
    const logicalPath = buildSkillLogicalPath(id, relativePath);
    const parsed = parseAgentResourcePath(logicalPath);
    if (
      parsed.skillId !== id ||
      !skill.resourcePaths.includes(logicalPath)
    ) {
      throw new AgentResourceError(
        "SKILL_RESOURCE_NOT_FOUND",
        "请求的 Skill 资源不存在。",
      );
    }

    return Object.freeze({
      skillId: id,
      logicalPath,
      relativePath: parsed.relativePath,
      absolutePath: path.join(
        skill.absoluteDir,
        ...parsed.relativePath.split("/"),
      ),
      absoluteSkillDir: skill.absoluteDir,
    });
  }

  get initialized() {
    return this.#initialized;
  }

  private getInternal(id: SkillId) {
    this.assertInitialized();
    const skill = this.#skills.get(id);
    if (!skill) {
      throw new AgentResourceError(
        "SKILL_NOT_REGISTERED",
        `Agent Skill 未注册：${id}`,
      );
    }
    return skill;
  }

  private assertInitialized() {
    if (!this.#initialized) {
      throw new AgentResourceError(
        "SKILL_REGISTRY_NOT_INITIALIZED",
        "Skill Registry 尚未初始化。",
      );
    }
  }
}

function toProjectSkill(
  id: SkillId,
  skill: DiscoveredProjectSkill,
): ProjectSkill {
  return Object.freeze({
    id,
    name: skill.name,
    description: skill.description,
    logicalDir: skill.logicalDir,
    logicalSkillFile: skill.logicalSkillFile,
    ...(skill.license ? { license: skill.license } : {}),
    ...(skill.compatibility
      ? { compatibility: skill.compatibility }
      : {}),
    metadata: skill.metadata,
    resourcePaths: skill.resourcePaths,
    digest: skill.digest,
    diagnostics: Object.freeze([]),
  });
}
