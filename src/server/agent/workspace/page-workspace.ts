import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ReferenceUsageSchema } from "@/shared/course-schema";

const MAX_HTML_CHARS = 200_000;
const MAX_READ_CHARS = 24_000;

/**
 * workspace 元数据只记录 HTML 无法可靠表达的资料来源；它不是页面内容 DSL。
 * 默认 strip 未知字段，使第一阶段已经写入的 draft JSON 仍可恢复。
 */
export const PageWorkspaceMetadataSchema = z
  .object({
    usedReferences: z.array(ReferenceUsageSchema).max(12).default([]),
  });

export type PageWorkspaceMetadata = z.infer<
  typeof PageWorkspaceMetadataSchema
>;

export type PageWorkspace = {
  directory: string;
  htmlPath: string;
  metadataPath: string;
  taskPath: string;
};

export type PageWorkspaceSnapshot = {
  exists: boolean;
  html: string;
  metadata?: PageWorkspaceMetadata;
  htmlBytes: number;
  updatedAt?: string;
};

export function resolvePageWorkspace(input: {
  taskId: string;
  workOrderId: string;
  rootDir?: string;
}): PageWorkspace {
  const configuredRoot =
    input.rootDir ?? process.env.AGENT_WORKSPACE_ROOT;
  const root = configuredRoot
    ? path.resolve(/*turbopackIgnore: true*/ configuredRoot)
    : path.join(process.cwd(), ".data", "agent-workspaces");
  const directory = path.join(
    root,
    safeSegment(input.taskId),
    safeSegment(input.workOrderId),
  );
  assertInsideRoot(root, directory);
  return {
    directory,
    htmlPath: path.join(directory, "index.html"),
    metadataPath: path.join(directory, "page.json"),
    taskPath: path.join(directory, "TASK.md"),
  };
}

export async function initializePageWorkspace(
  workspace: PageWorkspace,
  taskMarkdown: string,
  initial?: {
    html: string;
    metadata?: PageWorkspaceMetadata;
  },
) {
  await mkdir(workspace.directory, { recursive: true });
  await writeUtf8IfMissing(workspace.taskPath, taskMarkdown);
  if (initial) {
    await writeUtf8IfMissing(
      workspace.htmlPath,
      validateHtmlSize(initial.html),
    );
    await writeUtf8IfMissing(
      workspace.metadataPath,
      `${JSON.stringify(
        PageWorkspaceMetadataSchema.parse(initial.metadata ?? {}),
        null,
        2,
      )}\n`,
    );
  }
}

async function writeUtf8IfMissing(filePath: string, content: string) {
  try {
    await writeFile(filePath, content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function readPageWorkspace(
  workspace: PageWorkspace,
): Promise<PageWorkspaceSnapshot> {
  try {
    const [html, metadata, fileStat] = await Promise.all([
      readFile(workspace.htmlPath, "utf8"),
      readFile(workspace.metadataPath, "utf8"),
      stat(workspace.htmlPath),
    ]);
    return {
      exists: true,
      html,
      metadata: PageWorkspaceMetadataSchema.parse(JSON.parse(metadata)),
      htmlBytes: fileStat.size,
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, html: "", htmlBytes: 0 };
    }
    throw error;
  }
}

export async function readPageWorkspaceSlice(
  workspace: PageWorkspace,
  input: { offset?: number; maxChars?: number } = {},
) {
  const snapshot = await readPageWorkspace(workspace);
  const offset = Math.min(
    Math.max(0, input.offset ?? 0),
    snapshot.html.length,
  );
  const maxChars = Math.min(
    MAX_READ_CHARS,
    Math.max(1, input.maxChars ?? 12_000),
  );
  return {
    ...snapshot,
    html: snapshot.html.slice(offset, offset + maxChars),
    offset,
    nextOffset:
      offset + maxChars < snapshot.html.length
        ? offset + maxChars
        : null,
    totalChars: snapshot.html.length,
  };
}

export async function writePageWorkspace(input: {
  workspace: PageWorkspace;
  html: string;
  metadata?: PageWorkspaceMetadata;
}) {
  const html = validateHtmlSize(input.html);
  const metadata = PageWorkspaceMetadataSchema.parse(input.metadata ?? {});
  const current = await readPageWorkspace(input.workspace);
  if (
    current.exists &&
    current.html === html &&
    JSON.stringify(current.metadata) === JSON.stringify(metadata)
  ) {
    throw new Error(
      "本次编辑没有改变 index.html 或资料元数据；请根据最新 Browser Harness 问题做实质修订。",
    );
  }
  await mkdir(input.workspace.directory, { recursive: true });
  await Promise.all([
    writeFile(input.workspace.htmlPath, html, "utf8"),
    writeFile(
      input.workspace.metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    ),
  ]);
  return readPageWorkspace(input.workspace);
}

export async function replacePageWorkspaceText(input: {
  workspace: PageWorkspace;
  oldText: string;
  newText: string;
  metadata?: PageWorkspaceMetadata;
}) {
  const current = await readPageWorkspace(input.workspace);
  if (!current.exists) {
    throw new Error("页面 workspace 尚未创建，请先写入完整初稿。");
  }
  const first = current.html.indexOf(input.oldText);
  const second = current.html.indexOf(input.oldText, first + input.oldText.length);
  if (first < 0) {
    throw new Error("oldText 与当前 index.html 不匹配，请先读取最新 workspace。");
  }
  if (second >= 0) {
    throw new Error("oldText 在 index.html 中出现多次，请扩大匹配范围后重试。");
  }
  const html = validateHtmlSize(
    `${current.html.slice(0, first)}${input.newText}${current.html.slice(
      first + input.oldText.length,
    )}`,
  );
  return writePageWorkspace({
    workspace: input.workspace,
    html,
    metadata: input.metadata ?? current.metadata,
  });
}

function validateHtmlSize(value: string) {
  const html = value.trim();
  if (!html) throw new Error("index.html 不能为空。");
  if (html.length > MAX_HTML_CHARS) {
    throw new Error(`index.html 超过 ${MAX_HTML_CHARS} 字符上限。`);
  }
  return html;
}

function safeSegment(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  if (!safe) throw new Error("workspace 标识不能为空。");
  return safe;
}

function assertInsideRoot(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("workspace 路径超出允许范围。");
  }
}
