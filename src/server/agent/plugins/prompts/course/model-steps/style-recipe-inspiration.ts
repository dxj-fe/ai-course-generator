import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { SkillIds } from "@/server/agent/ids";
import {
  parseAgentResourcePath,
  type LoadedLocalResource,
} from "@/server/agent/skill";
import { getProjectSkillRegistry } from "@/server/setup/skills";
import type { StyleTemplate } from "@/shared/templates/style";

export const MAX_STYLE_RECIPE_DESCRIPTION_CHARS = 1_024;

const STYLE_RECIPE_PREFIX = "bold-template-pack/templates/";
const UNSAFE_DECK_RUNTIME_PATTERN =
  /(?:1920\s*(?:×|x)\s*1080|deck[-_\s]?(?:runtime|viewport|stage|controls)|fixed\s+(?:16:9\s+)?stage|viewport-base(?:\.css)?)/i;
const recipeDescriptionCache = new Map<
  string,
  Promise<LoadedLocalResource | undefined>
>();

/**
 * 只读取已选样式配方的 frontmatter description。它是柔性设计灵感，
 * 不得把整份 recipe 或 frontend-slides 的固定 deck 运行时注入课程页。
 */
export function loadStyleRecipeInspiration(
  style: StyleTemplate,
): Promise<LoadedLocalResource | undefined> {
  const recipePath = style.profile.recipePath;
  const cached = recipeDescriptionCache.get(recipePath);
  if (cached) return cached;

  const pending = loadStyleRecipeInspirationUncached(recipePath).catch(
    () => undefined,
  );
  recipeDescriptionCache.set(recipePath, pending);
  return pending;
}

async function loadStyleRecipeInspirationUncached(
  recipePath: string,
): Promise<LoadedLocalResource | undefined> {
  const parsedPath = parseAgentResourcePath(recipePath);
  if (
    parsedPath.skillId !== SkillIds.FrontendSlides ||
    !parsedPath.relativePath.startsWith(STYLE_RECIPE_PREFIX) ||
    !parsedPath.relativePath.endsWith("/design.md")
  ) {
    return undefined;
  }

  const registry = await getProjectSkillRegistry();
  const resource = registry.resolve(
    SkillIds.FrontendSlides,
    parsedPath.relativePath,
  );
  const source = await readFile(resource.absolutePath, "utf8");
  const description = extractStyleRecipeDescription(source);
  if (!description) return undefined;

  return Object.freeze({
    logicalPath: resource.logicalPath,
    digest: createHash("sha256").update(description).digest("hex"),
    content: description,
  });
}

/** 从 YAML frontmatter 中提取唯一允许进入 HTML prompt 的短描述。 */
export function extractStyleRecipeDescription(source: string) {
  const normalized = source.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
  if (!match) return undefined;

  let frontmatter: unknown;
  try {
    frontmatter = parse(match[1]);
  } catch {
    return undefined;
  }
  if (!isRecord(frontmatter) || typeof frontmatter.description !== "string") {
    return undefined;
  }

  const description = frontmatter.description.replace(/\s+/g, " ").trim();
  if (!description || UNSAFE_DECK_RUNTIME_PATTERN.test(description)) {
    return undefined;
  }

  return [...description]
    .slice(0, MAX_STYLE_RECIPE_DESCRIPTION_CHARS)
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
