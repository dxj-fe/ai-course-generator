import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseToolLedger } from "../../../../../src/server/course/run/tool-ledger";
import { createCourseToolOperationStore } from "../../../../../src/server/course/store/tool-operation";
import type {
  ArtifactRef,
  WorkOrder,
} from "../../../../../src/shared/course-schema";

const directories: string[] = [];
const NOW = "2026-07-29T08:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Course Tool Ledger", () => {
  it("只持久化输入哈希、公开摘要和 ArtifactRef，不复制工具大结果", async () => {
    const store = createCourseToolOperationStore({
      rootDir: await temporaryRoot(),
    });
    const ledger = createCourseToolLedger(store, runningWorkOrder());
    const handle = await ledger.begin({
      agentStepNumber: 2,
      input: {
        pageId: "page-intro",
        privateDraft: "不应原样写入数据库的长输入",
      },
      toolCallId: "tool-call-1",
      toolName: "submit_page",
      toolOrdinal: 1,
    });
    const artifactRef = pageArtifactRef();

    await ledger.complete({
      handle,
      output: {
        ok: true,
        committed: true,
        terminal: true,
        summary: "页面已通过 Gate 并提交。",
        data: {
          html: "<html>这个大结果不应进入工具台账</html>",
        },
        artifactRefs: [artifactRef],
      },
    });

    const [stored] = store.listByWorkOrder("work-order-page-intro");
    expect(stored).toMatchObject({
      executionAttempt: 1,
      agentStepNumber: 2,
      toolOrdinal: 1,
      toolCallId: "tool-call-1",
      toolName: "submit_page",
      status: "completed",
      safeSummary: "页面已通过 Gate 并提交。",
      outputArtifactRefs: [artifactRef],
    });
    expect(stored?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("privateDraft");
    expect(JSON.stringify(stored)).not.toContain("<html>");
  });

  it("同一次执行重新建立 ledger 时会从已有 ordinal 之后继续", async () => {
    const store = createCourseToolOperationStore({
      rootDir: await temporaryRoot(),
    });
    const workOrder = runningWorkOrder();
    const firstLedger = createCourseToolLedger(store, workOrder);
    const firstHandle = await firstLedger.begin({
      agentStepNumber: 1,
      input: { pageId: "page-intro" },
      toolName: "read_page_context",
      toolOrdinal: 1,
    });
    await firstLedger.complete({
      handle: firstHandle,
      output: {
        ok: true,
        committed: false,
        terminal: false,
        summary: "已读取上下文。",
        data: {},
      },
    });

    const resumedLedger = createCourseToolLedger(store, workOrder);
    const resumedHandle = await resumedLedger.begin({
      agentStepNumber: 1,
      input: { pageId: "page-intro" },
      toolName: "generate_page_content",
      toolOrdinal: 1,
    });
    await resumedLedger.fail({
      handle: resumedHandle,
      error: new Error("Provider 临时失败\n包含多余换行"),
    });

    expect(store.listByWorkOrder(workOrder.id)).toMatchObject([
      {
        agentStepNumber: 1,
        toolOrdinal: 1,
        status: "completed",
      },
      {
        agentStepNumber: 2,
        toolOrdinal: 2,
        status: "failed",
        safeSummary: "模型服务未返回有效结果，请稍后重试。",
      },
    ]);
  });
});

async function temporaryRoot() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "course-tool-ledger-test-"),
  );
  directories.push(directory);
  return directory;
}

function runningWorkOrder(): WorkOrder {
  return {
    lockVersion: 1,
    id: "work-order-page-intro",
    taskId: "task-course-tool-ledger",
    courseId: "course-tool-ledger",
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    agentId: "page-builder",
    kind: "build_page",
    scope: { type: "page", pageId: "page-intro" },
    status: "running",
    idempotencyKey: "task-course-tool-ledger:page-intro",
    inputArtifactRefs: [],
    buildDependencyPageIds: [],
    inputSealedAt: NOW,
    checkpointArtifactRefs: [],
    acceptance: ["提交通过 Page Gate 的页面"],
    allowedTools: ["submit_page"],
    budget: {
      maxSteps: 12,
      maxToolCalls: 12,
      timeoutMs: 480_000,
      maxOutputTokens: 64_000,
    },
    executionAttempt: 1,
    revision: 1,
    leaseOwner: "worker-page-intro",
    leaseExpiresAt: "2026-07-29T08:10:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function pageArtifactRef(): ArtifactRef {
  return {
    id: "artifact-page-intro-html",
    kind: "page_html",
    courseId: "course-tool-ledger",
    pageId: "page-intro",
    scopeKey: "page:page-intro",
    revision: 1,
    contentHash: "1234567890abcdef",
  };
}
