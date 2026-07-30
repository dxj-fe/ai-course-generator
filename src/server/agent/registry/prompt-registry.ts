import { promises as fs } from "node:fs";
import path from "node:path";

import type { PromptId } from "@/server/agent/ids";
import type { PromptDefinition } from "@/server/agent/types/prompt";

const VARIABLE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;

export class PromptRegistry {
  readonly #definitions = new Map<PromptId, PromptDefinition>();
  readonly #content = new Map<PromptId, Promise<string>>();
  readonly #promptRoot: string;
  #frozen = false;

  constructor(projectRoot = process.cwd()) {
    this.#promptRoot = path.resolve(
      projectRoot,
      "src/server/agent/plugins/prompts",
    );
  }

  register(definition: PromptDefinition) {
    this.assertMutable();
    if (this.#definitions.has(definition.id)) {
      throw new Error(`Prompt ID 重复注册：${definition.id}`);
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`Prompt ${definition.id} 的 version 必须是正整数。`);
    }
    if (
      path.isAbsolute(definition.templatePath) ||
      definition.templatePath
        .split("/")
        .some((segment) => !segment || segment === ".." || segment === ".")
    ) {
      throw new Error(`Prompt ${definition.id} 的模板路径无效。`);
    }
    this.#definitions.set(
      definition.id,
      Object.freeze({
        ...definition,
        variables: Object.freeze([...definition.variables]),
      }),
    );
    return this;
  }

  get(id: PromptId) {
    const definition = this.#definitions.get(id);
    if (!definition) throw new Error(`Prompt 未注册：${id}`);
    return definition;
  }

  list() {
    return Object.freeze([...this.#definitions.values()]);
  }

  async render(
    id: PromptId,
    variables: Readonly<Record<string, string>>,
  ) {
    const definition = this.get(id);
    const content = await this.load(definition);
    const declaredVariables = validateTemplateVariables(
      definition,
      content,
    );
    const missing = definition.variables.filter(
      (variable) => !(variable in variables),
    );
    const unexpected = Object.keys(variables).filter(
      (variable) => !declaredVariables.has(variable),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Prompt ${id} 变量不匹配：缺少 ${missing.join(", ") || "无"}；多余 ${unexpected.join(", ") || "无"}。`,
      );
    }

    return content.replace(
      VARIABLE_PATTERN,
      (_, variable: string) => variables[variable]!,
    );
  }

  freeze() {
    this.#frozen = true;
    return this;
  }

  get frozen() {
    return this.#frozen;
  }

  async validate() {
    for (const definition of this.#definitions.values()) {
      validateTemplateVariables(
        definition,
        await this.load(definition),
      );
    }
    return this;
  }

  private load(definition: PromptDefinition) {
    let content = this.#content.get(definition.id);
    if (!content) {
      const absolutePath = path.resolve(
        this.#promptRoot,
        definition.templatePath,
      );
      const relative = path.relative(this.#promptRoot, absolutePath);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(`Prompt ${definition.id} 的模板路径越界。`);
      }
      content = fs.readFile(absolutePath, "utf8").then((value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          throw new Error(`Prompt ${definition.id} 模板不能为空。`);
        }
        return trimmed;
      });
      this.#content.set(definition.id, content);
    }
    return content;
  }

  private assertMutable() {
    if (this.#frozen) {
      throw new Error("Prompt Registry 已冻结，运行期间不能注册或替换 Prompt。");
    }
  }
}

function validateTemplateVariables(
  definition: PromptDefinition,
  content: string,
) {
  const actualVariables = new Set(
    Array.from(
      content.matchAll(VARIABLE_PATTERN),
      (match) => match[1]!,
    ),
  );
  const declaredVariables = new Set(definition.variables);
  if (
    actualVariables.size !== declaredVariables.size ||
    [...actualVariables].some(
      (variable) => !declaredVariables.has(variable),
    )
  ) {
    throw new Error(
      `Prompt ${definition.id} 的模板变量与注册定义不一致。`,
    );
  }
  return declaredVariables;
}
