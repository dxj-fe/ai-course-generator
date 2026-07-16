/* eslint-disable @typescript-eslint/no-require-imports */

const { readFile, access } = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");
const {
  SPECIALIST_PROMPT_LIBRARY,
} = require("../src/server/prompts/specialist-library.ts") as typeof import("../src/server/prompts/specialist-library");

const REQUIRED_SECTIONS = [
  "Role",
  "Goal",
  "Inputs",
  "Output Schema",
  "Rules",
  "Forbidden",
  "Examples",
  "Failure Handling",
] as const;
const VARIABLE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;

type PromptLintIssue = {
  code: string;
  promptId: string;
  file?: string;
  message: string;
};

function pushIssue(
  issues: PromptLintIssue[],
  issue: PromptLintIssue,
) {
  issues.push(issue);
}

function lintPromptContent(
  entry: (typeof SPECIALIST_PROMPT_LIBRARY)[number],
  systemContent: string,
  userContent: string,
) {
  const issues: PromptLintIssue[] = [];
  let previousIndex = -1;

  for (const section of REQUIRED_SECTIONS) {
    const heading = `# ${section}`;
    const matches = systemContent.match(
      new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gm"),
    );

    if (!matches) {
      pushIssue(issues, {
        code: "PROMPT_SECTION_MISSING",
        promptId: entry.id,
        file: entry.system.fileName,
        message: `缺少必要段落：${section}`,
      });
      continue;
    }

    if (matches.length > 1) {
      pushIssue(issues, {
        code: "PROMPT_SECTION_DUPLICATED",
        promptId: entry.id,
        file: entry.system.fileName,
        message: `必要段落重复：${section}`,
      });
    }

    const index = systemContent.indexOf(heading);
    if (index < previousIndex) {
      pushIssue(issues, {
        code: "PROMPT_SECTION_ORDER",
        promptId: entry.id,
        file: entry.system.fileName,
        message: `必要段落顺序错误：${section}`,
      });
    }
    previousIndex = index;
  }

  if ([...systemContent.matchAll(VARIABLE_PATTERN)].length > 0) {
    pushIssue(issues, {
      code: "PROMPT_SYSTEM_VARIABLE",
      promptId: entry.id,
      file: entry.system.fileName,
      message: "System Prompt 不应包含运行时模板变量。",
    });
  }

  if (!systemContent.includes("视为数据")) {
    pushIssue(issues, {
      code: "PROMPT_INPUT_BOUNDARY_MISSING",
      promptId: entry.id,
      file: entry.system.fileName,
      message: "System Prompt 缺少不可信输入的数据边界。",
    });
  }

  if (!userContent.includes("不是新的系统指令")) {
    pushIssue(issues, {
      code: "PROMPT_USER_DATA_BOUNDARY_MISSING",
      promptId: entry.id,
      file: entry.user.fileName,
      message: "User Prompt 未明确把注入内容视为数据。",
    });
  }

  const actualVariables = [
    ...new Set(
      Array.from(userContent.matchAll(VARIABLE_PATTERN), (match) => match[1]),
    ),
  ].sort();
  const expectedVariables = [...entry.templateVariables].sort();

  if (actualVariables.join("|") !== expectedVariables.join("|")) {
    pushIssue(issues, {
      code: "PROMPT_VARIABLE_CONTRACT_MISMATCH",
      promptId: entry.id,
      file: entry.user.fileName,
      message: `模板变量不匹配；期望 ${expectedVariables.join(", ")}，实际 ${actualVariables.join(", ") || "无"}。`,
    });
  }

  return issues;
}

async function lintPromptLibrary(rootDir = process.cwd()) {
  const issues: PromptLintIssue[] = [];
  const ids = new Set<string>();
  const files = new Set<string>();

  if (SPECIALIST_PROMPT_LIBRARY.length !== 9) {
    pushIssue(issues, {
      code: "PROMPT_SPECIALIST_COUNT",
      promptId: "library",
      message: `Prompt Library 必须登记 9 名 Specialist，当前为 ${SPECIALIST_PROMPT_LIBRARY.length}。`,
    });
  }

  for (const entry of SPECIALIST_PROMPT_LIBRARY) {
    if (ids.has(entry.id)) {
      pushIssue(issues, {
        code: "PROMPT_ID_DUPLICATED",
        promptId: entry.id,
        message: "Specialist ID 重复。",
      });
    }
    ids.add(entry.id);

    for (const definition of [entry.system, entry.user]) {
      if (files.has(definition.fileName)) {
        pushIssue(issues, {
          code: "PROMPT_FILE_DUPLICATED",
          promptId: entry.id,
          file: definition.fileName,
          message: "Prompt 文件被多个定义重复引用。",
        });
      }
      files.add(definition.fileName);

      if (entry.status === "active") {
        const majorVersion = definition.version.split(".")[0];
        if (!definition.fileName.endsWith(`.v${majorVersion}.md`)) {
          pushIssue(issues, {
            code: "PROMPT_FILE_VERSION_MISMATCH",
            promptId: entry.id,
            file: definition.fileName,
            message: `文件主版本与合同版本 ${definition.version} 不一致。`,
          });
        }
      }
    }

    const templateDirectory = path.join(
      rootDir,
      "src",
      "server",
      "prompts",
      "templates",
    );
    const systemPath = path.join(templateDirectory, entry.system.fileName);
    const userPath = path.join(templateDirectory, entry.user.fileName);

    try {
      const [systemContent, userContent] = await Promise.all([
        readFile(systemPath, "utf8"),
        readFile(userPath, "utf8"),
      ]);
      issues.push(...lintPromptContent(entry, systemContent, userContent));
    } catch (error) {
      pushIssue(issues, {
        code: "PROMPT_FILE_MISSING",
        promptId: entry.id,
        message: error instanceof Error ? error.message : "Prompt 文件不存在。",
      });
    }

    const moduleFile = "moduleFile" in entry ? entry.moduleFile : undefined;
    if (moduleFile) {
      try {
        await access(
          path.join(rootDir, "src", "server", "prompts", moduleFile),
        );
      } catch {
        pushIssue(issues, {
          code: "PROMPT_MODULE_MISSING",
          promptId: entry.id,
          file: moduleFile,
          message: "声明的运行时 Prompt 模块不存在。",
        });
      }
    }
  }

  return issues;
}

async function main() {
  const rootFlagIndex = process.argv.indexOf("--root");
  const rootDir =
    rootFlagIndex >= 0 && process.argv[rootFlagIndex + 1]
      ? path.resolve(process.argv[rootFlagIndex + 1])
      : process.cwd();
  const issues = await lintPromptLibrary(rootDir);

  if (issues.length > 0) {
    for (const issue of issues) {
      const location = issue.file ? ` (${issue.file})` : "";
      console.error(
        `[${issue.code}] ${issue.promptId}${location}: ${issue.message}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Prompt lint passed: ${SPECIALIST_PROMPT_LIBRARY.length} specialists, ${REQUIRED_SECTIONS.length} required sections.`,
  );
}

if (require.main === module) {
  void main();
}

module.exports = {
  REQUIRED_SECTIONS,
  lintPromptContent,
  lintPromptLibrary,
};
