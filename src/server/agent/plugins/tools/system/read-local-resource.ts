import { tool } from "ai";
import { z } from "zod";

import {
  AgentResourceError,
  type LocalResourceSession,
  type SkillRegistry,
} from "@/server/agent/skill";
import { readLocalAgentResource } from "@/server/infra/file/safe-reader";

const ReadLocalResourceInputSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        "Registry Catalog 或已读取 Skill 文件中给出的 agent/skills/... 逻辑路径",
      ),
  })
  .strict();

export function createReadLocalResourceTool(input: {
  registry: SkillRegistry;
  session: LocalResourceSession;
}) {
  return tool({
    description:
      "渐进读取当前 Agent 已获授权的项目 Skill 文件。只接受 agent/skills/... 逻辑路径，不能读取源码、配置、数据库或其他宿主文件。",
    inputSchema: ReadLocalResourceInputSchema,
    execute: async ({ path }) => {
      try {
        const resource = await readLocalAgentResource({
          path,
          registry: input.registry,
          session: input.session,
        });
        return {
          ok: true as const,
          committed: false,
          terminal: false,
          summary: resource.alreadyRead
            ? "该版本资源已在当前 Agent Session 中读取，不重复注入。"
            : `已读取 ${resource.logicalPath}。`,
          data: resource,
        };
      } catch (error) {
        const resourceError =
          error instanceof AgentResourceError
            ? error
            : new AgentResourceError(
                "LOCAL_RESOURCE_READ_FAILED",
                "本地资源读取失败。",
              );
        return {
          ok: false as const,
          committed: false,
          terminal: false,
          code: resourceError.code,
          message: resourceError.message,
          retryable: false,
          feedback: [
            "请只使用 available_skills 或已读取 Skill 文件给出的逻辑路径。",
          ],
        };
      }
    },
  });
}

export type ReadLocalResourceTool = ReturnType<
  typeof createReadLocalResourceTool
>;
