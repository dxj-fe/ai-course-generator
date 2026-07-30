import type { SkillCatalogEntry } from "@/server/agent/skill/types";

export function formatSkillCatalog(
  catalog: readonly SkillCatalogEntry[],
) {
  if (catalog.length === 0) return "<available_skills />";

  return `<available_skills>
${catalog
  .map(
    (skill) => `  <skill>
    <name>${escapeXml(skill.name)}</name>
    <description>${escapeXml(skill.description)}</description>
    <location>${escapeXml(skill.location)}</location>
  </skill>`,
  )
  .join("\n")}
</available_skills>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
