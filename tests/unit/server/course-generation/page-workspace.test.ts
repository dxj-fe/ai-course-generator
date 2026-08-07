import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  initializePageWorkspace,
  readPageWorkspace,
  readPageWorkspaceSlice,
  replacePageWorkspaceText,
  resolvePageWorkspace,
  writePageWorkspace,
} from "../../../../src/server/agent/workspace/page-workspace";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Page Creator workspace", () => {
  it("在独立 WorkOrder 目录中直接保存 HTML，不要求内容 DSL", async () => {
    const workspace = await createWorkspace();
    await initializePageWorkspace(workspace, "# 页面任务\n自由完成页面。\n");

    const snapshot = await writePageWorkspace({
      workspace,
      html: "<!doctype html><html><body><main>初稿</main></body></html>",
    });

    expect(snapshot).toMatchObject({
      exists: true,
      html: "<!doctype html><html><body><main>初稿</main></body></html>",
      metadata: { usedReferences: [] },
    });
    expect(workspace.directory).toContain(
      path.join("task-safe", "work-order-safe"),
    );
    expect(workspace.directory).not.toContain(
      path.join("work-order-safe", "2"),
    );
  });

  it("支持先读取局部内容，再用唯一文本做精确修改", async () => {
    const workspace = await createWorkspace();
    await writePageWorkspace({
      workspace,
      html: "<main>旧标题<section>解释内容</section></main>",
    });

    const slice = await readPageWorkspaceSlice(workspace, {
      offset: 6,
      maxChars: 8,
    });
    expect(slice).toMatchObject({
      html: "旧标题<sect",
      offset: 6,
      nextOffset: 14,
    });

    await replacePageWorkspaceText({
      workspace,
      oldText: "旧标题",
      newText: "由 Agent 改写的新标题",
    });
    await expect(readPageWorkspace(workspace)).resolves.toMatchObject({
      html: "<main>由 Agent 改写的新标题<section>解释内容</section></main>",
    });
  });

  it("重试时复用同一 WorkOrder workspace，且只在文件缺失时用 checkpoint 初始化", async () => {
    const workspace = await createWorkspace();
    await initializePageWorkspace(workspace, "# 页面任务", {
      html: "<main>数据库 checkpoint</main>",
    });
    await writePageWorkspace({
      workspace,
      html: "<main>Agent 尚未 checkpoint 的新版本</main>",
    });

    await initializePageWorkspace(workspace, "# 页面任务", {
      html: "<main>较旧 checkpoint</main>",
    });

    await expect(readPageWorkspace(workspace)).resolves.toMatchObject({
      html: "<main>Agent 尚未 checkpoint 的新版本</main>",
    });
  });

  it("拒绝含糊的多处替换，防止 Agent 意外改坏整页", async () => {
    const workspace = await createWorkspace();
    await writePageWorkspace({
      workspace,
      html: "<main><p>重复内容</p><p>重复内容</p></main>",
    });

    await expect(
      replacePageWorkspaceText({
        workspace,
        oldText: "重复内容",
        newText: "新内容",
      }),
    ).rejects.toThrow("出现多次");
  });

  it("拒绝把相同 HTML 反复写入，避免 Agent Loop 空转", async () => {
    const workspace = await createWorkspace();
    const html = "<main><p>保持不变</p></main>";
    await writePageWorkspace({ workspace, html });

    await expect(
      writePageWorkspace({ workspace, html }),
    ).rejects.toThrow("没有改变 index.html");
    await expect(
      replacePageWorkspaceText({
        workspace,
        oldText: "保持不变",
        newText: "保持不变",
      }),
    ).rejects.toThrow("没有改变 index.html");
  });
});

async function createWorkspace() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "page-workspace-test-"));
  directories.push(rootDir);
  return resolvePageWorkspace({
    taskId: "task-safe",
    workOrderId: "work-order-safe",
    rootDir,
  });
}
