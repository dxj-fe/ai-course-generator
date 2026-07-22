import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRetrievalRegistryDocument,
  renderRetrievalRegistryMarkdown,
} from "../../../../src/server/tools/retrieval-card-registry";

describe("Agent Retrieval Registry documentation", () => {
  it("keeps JSON and Markdown synchronized with the runtime registry", () => {
    const jsonPath = resolve(
      process.cwd(),
      "docs/agent-retrieval-registry.json",
    );
    const markdownPath = resolve(
      process.cwd(),
      "docs/agent-retrieval-registry.md",
    );

    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual(
      getRetrievalRegistryDocument(),
    );
    expect(readFileSync(markdownPath, "utf8")).toBe(
      renderRetrievalRegistryMarkdown(),
    );
  });
});
