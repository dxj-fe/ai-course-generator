import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  PromptTemplate,
  PromptTemplateDefinition,
} from "./types";

const PROMPT_DIRECTORY = path.join(
  process.cwd(),
  "src",
  "server",
  "prompts",
  "templates",
);
const promptContentCache = new Map<string, Promise<string>>();
const VARIABLE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;

export async function loadPromptTemplate(
  definition: PromptTemplateDefinition,
): Promise<PromptTemplate> {
  return {
    name: definition.name,
    version: definition.version,
    role: definition.role,
    inputContract: definition.inputContract,
    outputContract: definition.outputContract,
    content: await readPromptContent(definition.fileName, definition.version),
  };
}

export function renderPromptTemplate(
  template: PromptTemplate,
  variables: Readonly<Record<string, string>>,
) {
  const expectedVariables = new Set(
    Array.from(template.content.matchAll(VARIABLE_PATTERN), (match) => match[1]),
  );
  const missingVariables = [...expectedVariables].filter(
    (name) => !(name in variables),
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Prompt ${template.name}@${template.version} 缺少变量：${missingVariables.join(", ")}`,
    );
  }

  const unexpectedVariables = Object.keys(variables).filter(
    (name) => !expectedVariables.has(name),
  );

  if (unexpectedVariables.length > 0) {
    throw new Error(
      `Prompt ${template.name}@${template.version} 包含未声明变量：${unexpectedVariables.join(", ")}`,
    );
  }

  return template.content.replace(
    VARIABLE_PATTERN,
    (_, name: string) => variables[name],
  );
}

function readPromptContent(fileName: string, version: string) {
  const cacheKey = `${fileName}@${version}`;
  let content = promptContentCache.get(cacheKey);

  if (!content) {
    content = readFile(path.join(PROMPT_DIRECTORY, fileName), "utf8").then(
      (value) => value.trim(),
    );
    promptContentCache.set(cacheKey, content);
  }

  return content;
}
