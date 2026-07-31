import {
  loadPageBuilderSnapshot,
  type PageBuilderExecution,
} from "@/server/agent/plugins/contexts/course/page-builder";
import {
  FatalAgentRuntimeError,
  throwIfAgentAborted,
} from "@/server/agent/runtime";
import { hashStorageValue } from "@/server/infra/database/codec";
import { isRetryableModelError } from "@/server/infra/ai/model-router";
import {
  HtmlOutputSchema,
  PageContentDSLSchema,
  type ArtifactRef,
} from "@/shared/course-schema";

export type PageReferenceSearchInput = {
  query?: string;
  referencePackId?: string;
  chunkIds?: string[];
};

export function fixTargetIsUnchanged(
  execution: PageBuilderExecution,
  kind: "page_content" | "page_html",
  payload:
    | ReturnType<typeof PageContentDSLSchema.parse>
    | ReturnType<typeof HtmlOutputSchema.parse>,
) {
  if (
    execution.initialWorkOrder.kind !== "fix_page" ||
    execution.fixPlan?.targetArtifact !== kind ||
    !execution.baseline
  ) {
    return false;
  }
  return kind === "page_content"
    ? hashStorageValue(payload) ===
        hashStorageValue(execution.baseline.content)
    : HtmlOutputSchema.parse(payload).html ===
        execution.baseline.html.html;
}

export function selectAuthorizedReferenceChunks(
  execution: PageBuilderExecution,
  input: PageReferenceSearchInput,
) {
  const query = input.query?.toLocaleLowerCase();
  const usages = execution.pageTask.referenceUsages.filter(
    ({ referencePackId }) =>
      !input.referencePackId ||
      referencePackId === input.referencePackId,
  );
  const requestedChunks = new Set(input.chunkIds ?? []);
  const selected = usages.flatMap((usage) => {
    const pack = execution.referencePacks.find(
      ({ id }) => id === usage.referencePackId,
    );
    if (!pack) return [];
    const allowedChunks = new Set(usage.chunkIds);
    return pack.chunks
      .filter(
        ({ id }) =>
          allowedChunks.has(id) &&
          (requestedChunks.size === 0 ||
            requestedChunks.has(id)),
      )
      .filter(
        ({ text }) =>
          !query ||
          text.toLocaleLowerCase().includes(query),
      )
      .map((chunk) => ({
        referencePackId: pack.id,
        sourceName: pack.sourceName,
        chunkId: chunk.id,
        text: chunk.text,
      }));
  });
  return selected.slice(0, 8);
}

export function checkpointSummary(
  snapshot: ReturnType<typeof loadPageBuilderSnapshot>,
) {
  return {
    content: snapshot.content
      ? {
          blockCount: snapshot.content.blocks.length,
          assetSlotCount: snapshot.content.assetSlots.length,
        }
      : null,
    assets: snapshot.assets
      ? { count: snapshot.assets.length }
      : null,
    html: snapshot.html
      ? {
          bytes: new TextEncoder().encode(snapshot.html.html)
            .byteLength,
        }
      : null,
    quality: snapshot.quality
      ? {
          decision: snapshot.quality.decision,
          overallScore: snapshot.quality.overallScore,
          issueCodes: snapshot.quality.issues.map(
            ({ code }) => code,
          ),
        }
      : null,
  };
}

export function reused(
  workOrder: ReturnType<
    typeof loadPageBuilderSnapshot
  >["workOrder"],
  kind: ArtifactRef["kind"],
  summary: string,
) {
  const ref = workOrder.checkpointArtifactRefs.find(
    (candidate) => candidate.kind === kind,
  );
  return success({
    committed: true,
    summary,
    data: { reused: true, artifactRef: ref },
    artifactRefs: ref ? [ref] : undefined,
  });
}

export function toArtifactRef(artifact: {
  id: string;
  kind: ArtifactRef["kind"];
  courseId?: string;
  pageId?: string;
  scopeKey?: string;
  revision?: number;
  contentHash?: string;
}): ArtifactRef {
  return artifact as ArtifactRef;
}

export function success<Data>(input: {
  committed: boolean;
  data: Data;
  summary: string;
  terminal?: boolean;
  artifactRefs?: ArtifactRef[];
}) {
  return {
    ok: true as const,
    committed: input.committed,
    terminal: input.terminal ?? false,
    summary: input.summary,
    data: input.data,
    artifactRefs: input.artifactRefs,
  };
}

export function failure(
  code: string,
  message: string,
  feedback?: string[],
  retryable = true,
) {
  return {
    ok: false as const,
    committed: false as const,
    terminal: false as const,
    code,
    message,
    retryable,
    feedback,
  };
}

const RECOVERABLE_MODEL_STEP_CODES = new Set([
  "MODEL_ERROR",
  "MODEL_STEP_EXECUTION_ERROR",
  "MODEL_STEP_OUTPUT_MISSING",
  "RATE_LIMIT_ERROR",
  "SCHEMA_ERROR",
  "TIMEOUT_ERROR",
]);

/**
 * ModelStep 会把 Provider 异常投影成可序列化 state.error。跨过工具适配层时
 * 保留错误码，避免重新 new Error 后丢失“可重试”语义并误杀整个课程。
 */
export class PageBuilderModelStepError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PageBuilderModelStepError";
    this.retryable = RECOVERABLE_MODEL_STEP_CODES.has(code);
  }
}

export async function recoverableModelStep<Data>(
  execute: () => Promise<Data>,
  abortSignal: AbortSignal | undefined,
  code: string,
  message: string,
) {
  try {
    throwIfAgentAborted(abortSignal);
    const data = await execute();
    throwIfAgentAborted(abortSignal);
    return {
      ok: true as const,
      data,
    };
  } catch (error) {
    throwIfAgentAborted(abortSignal);
    if (error instanceof PageBuilderModelStepError) {
      if (!error.retryable) {
        throw new FatalAgentRuntimeError(code, message, error);
      }
      return failure(
        code,
        message,
        [error.message.slice(0, 500)],
      );
    }
    if (!isRetryableModelError(error)) {
      throw new FatalAgentRuntimeError(code, message, error);
    }
    return failure(code, message);
  }
}

export function createExclusiveRunner() {
  let tail = Promise.resolve();
  return <Output>(execute: () => Promise<Output>) => {
    const result = tail.then(execute, execute);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
