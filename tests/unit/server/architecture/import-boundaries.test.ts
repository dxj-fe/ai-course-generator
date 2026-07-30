import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.join(process.cwd(), "src");
const IMPORT_PATTERN =
  /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

describe("后端 import 边界", () => {
  it("Route 不绕过 setup 或业务门面读取 Agent、Store 和数据库实现", () => {
    const forbidden = [
      "@/server/agent/plugins/",
      "@/server/course/",
      "@/server/infra/database/",
      "@/server/infra/file/",
      "@/server/conversation/store",
      "@/server/preview/store",
      "@/server/reference/",
    ];

    expect(
      findViolations(path.join(SOURCE_ROOT, "app"), (specifier) =>
        forbidden.some((prefix) => specifier.startsWith(prefix)),
      ),
    ).toEqual([]);
  });

  it("shared 保持浏览器安全，不反向依赖 server", () => {
    expect(
      findViolations(
        path.join(SOURCE_ROOT, "shared"),
        (specifier) => specifier.startsWith("@/server/"),
      ),
    ).toEqual([]);
  });

  it("整个 server 不反向依赖 app 或 features", () => {
    const violations = findViolations(
      path.join(SOURCE_ROOT, "server"),
      (specifier) =>
        specifier.startsWith("@/app/") ||
        specifier.startsWith("@/features/"),
    );

    expect(violations).toEqual([]);
  });

  it("course 只按统一 Catalog 读取 Agent 配置，不导入具体 Agent 或 Handler", () => {
    expect(
      findViolations(
        path.join(SOURCE_ROOT, "server/course"),
        (specifier) =>
          specifier.startsWith("@/server/agent/plugins/agents/"),
      ),
    ).toEqual([]);
  });
});

function findViolations(
  root: string,
  isForbidden: (specifier: string) => boolean,
) {
  return sourceFiles(root).flatMap((file) => {
    const content = readFileSync(file, "utf8");
    return Array.from(content.matchAll(IMPORT_PATTERN))
      .map((match) => match[1]!)
      .filter(isForbidden)
      .map((specifier) => ({
        file: path.relative(process.cwd(), file),
        specifier,
      }));
  });
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}
