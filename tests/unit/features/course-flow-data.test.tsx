import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CourseFlowInspector } from "@/features/course-flow-inspector/course-flow-inspector";
import {
  FLOW_EDGES,
  FLOW_NODES,
  FLOW_RISK_SUMMARY,
  FLOW_STAGE_META,
} from "@/features/course-flow-inspector/course-flow-data";

describe("course flow inspector data", () => {
  it("keeps node and edge identifiers valid", () => {
    const nodeIds = FLOW_NODES.map(({ id }) => id);
    const knownNodeIds = new Set(nodeIds);

    expect(knownNodeIds.size).toBe(nodeIds.length);
    expect(new Set(FLOW_EDGES.map(({ id }) => id)).size).toBe(
      FLOW_EDGES.length,
    );

    for (const edge of FLOW_EDGES) {
      expect(knownNodeIds.has(edge.from), edge.id).toBe(true);
      expect(knownNodeIds.has(edge.to), edge.id).toBe(true);
    }
  });

  it("documents every node with actionable source-backed details", () => {
    for (const node of FLOW_NODES) {
      expect(FLOW_STAGE_META[node.stage]).toBeDefined();
      expect(node.purpose.length).toBeGreaterThan(10);
      expect(node.inputs.length).toBeGreaterThan(0);
      expect(node.actions.length).toBeGreaterThan(0);
      expect(node.outputs.length).toBeGreaterThan(0);
      expect(node.failures.length).toBeGreaterThan(0);
      expect(node.files.length).toBeGreaterThan(0);
      expect(node.files.every((file) => file.startsWith("src/"))).toBe(true);
    }
  });

  it("links every risk summary to existing nodes", () => {
    const knownNodeIds = new Set(FLOW_NODES.map(({ id }) => id));

    for (const risk of FLOW_RISK_SUMMARY) {
      expect(risk.priority).toMatch(/^P[0-2]$/);
      expect(risk.nodeIds.length).toBeGreaterThan(0);
      expect(risk.nodeIds.every((id) => knownNodeIds.has(id))).toBe(true);
    }
  });

  it("renders the canvas controls and source-backed node inspector", () => {
    const markup = renderToStaticMarkup(<CourseFlowInspector />);

    expect(markup).toContain("一句话，如何变成一门课");
    expect(markup).toContain("适配画布");
    expect(markup).toContain("Page QA，风险：高风险");
    expect(markup).toContain("POST /api/courses/tasks");
    expect(markup).toContain("src/server/tasks/course-generation-task-service.ts");
  });
});
