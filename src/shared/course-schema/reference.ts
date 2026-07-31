import { z } from "zod";

export const REFERENCE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_MAX_PACKS = 3;
export const REFERENCE_MAX_CHUNKS = 24;

export const ReferenceSourceTypeSchema = z.enum(["txt", "md", "pdf"]);

export const ReferenceChunkSchema = z
  .object({
    id: z.string().regex(/^chunk-[0-9]{2}$/),
    index: z.number().int().positive().max(REFERENCE_MAX_CHUNKS),
    text: z.string().min(1).max(1_600),
  })
  .strict();

export const ReferenceKeyFactSchema = z
  .object({
    text: z.string().min(2).max(500),
    chunkIds: z.array(z.string().regex(/^chunk-[0-9]{2}$/)).min(1).max(4),
  })
  .strict()
  .superRefine((fact, context) => {
    if (new Set(fact.chunkIds).size !== fact.chunkIds.length) {
      context.addIssue({
        code: "custom",
        message: "关键事实不能重复引用同一个 chunk",
        path: ["chunkIds"],
      });
    }
  });

export const ReferencePackSchema = z
  .object({
    id: z.string().regex(/^ref-[a-f0-9]{24}$/),
    sourceName: z.string().min(1).max(200),
    sourceType: ReferenceSourceTypeSchema,
    byteSize: z.number().int().positive().max(REFERENCE_FILE_MAX_BYTES),
    summary: z.string().min(2).max(1_000),
    keyFacts: z.array(ReferenceKeyFactSchema).max(12),
    chunks: z.array(ReferenceChunkSchema).min(1).max(REFERENCE_MAX_CHUNKS),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((pack, context) => {
    const chunkIds = pack.chunks.map(({ id }) => id);
    const availableChunkIds = new Set(chunkIds);

    if (availableChunkIds.size !== chunkIds.length) {
      context.addIssue({
        code: "custom",
        message: "Reference Pack 不能包含重复 chunk ID",
        path: ["chunks"],
      });
    }

    pack.chunks.forEach((chunk, index) => {
      if (chunk.index !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `chunk 顺序应为 ${index + 1}`,
          path: ["chunks", index, "index"],
        });
      }
    });

    pack.keyFacts.forEach((fact, factIndex) => {
      fact.chunkIds.forEach((chunkId, chunkIndex) => {
        if (!availableChunkIds.has(chunkId)) {
          context.addIssue({
            code: "custom",
            message: `关键事实引用了不存在的 chunk ${chunkId}`,
            path: ["keyFacts", factIndex, "chunkIds", chunkIndex],
          });
        }
      });
    });
  });

export const ReferenceUsageSchema = z
  .object({
    referencePackId: z.string().regex(/^ref-[a-f0-9]{24}$/),
    chunkIds: z.array(z.string().regex(/^chunk-[0-9]{2}$/)).min(1).max(8),
  })
  .strict()
  .superRefine((usage, context) => {
    if (new Set(usage.chunkIds).size !== usage.chunkIds.length) {
      context.addIssue({
        code: "custom",
        message: "页面资料引用不能包含重复 chunk ID",
        path: ["chunkIds"],
      });
    }
  });

export function validateReferenceUsages(
  usages: readonly ReferenceUsage[],
  packs: readonly ReferencePack[],
) {
  const packsById = new Map(packs.map((pack) => [pack.id, pack]));
  const issues: string[] = [];
  const seenPackIds = new Set<string>();

  for (const usage of usages) {
    if (seenPackIds.has(usage.referencePackId)) {
      issues.push(`重复引用资料 ${usage.referencePackId}`);
      continue;
    }
    seenPackIds.add(usage.referencePackId);

    const pack = packsById.get(usage.referencePackId);
    if (!pack) {
      issues.push(`引用了不存在的资料 ${usage.referencePackId}`);
      continue;
    }

    const chunkIds = new Set(pack.chunks.map(({ id }) => id));
    for (const chunkId of usage.chunkIds) {
      if (!chunkIds.has(chunkId)) {
        issues.push(`资料 ${pack.id} 不包含 ${chunkId}`);
      }
    }
  }

  return issues;
}

export type ReferenceSourceType = z.infer<typeof ReferenceSourceTypeSchema>;
export type ReferenceChunk = z.infer<typeof ReferenceChunkSchema>;
export type ReferenceKeyFact = z.infer<typeof ReferenceKeyFactSchema>;
export type ReferencePack = z.infer<typeof ReferencePackSchema>;
export type ReferenceUsage = z.infer<typeof ReferenceUsageSchema>;
