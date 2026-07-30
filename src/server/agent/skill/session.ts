import type { SkillId } from "@/server/agent/ids";
import { AgentResourceError } from "@/server/agent/skill/errors";
import type {
  LoadedLocalResource,
  LocalResourceReadRecord,
  ReadLocalResourceGrant,
} from "@/server/agent/skill/types";

export class LocalResourceSession {
  readonly #grant: ReadLocalResourceGrant;
  readonly #skillIds: ReadonlySet<SkillId>;
  readonly #digests = new Set<string>();
  readonly #activatedSkills = new Set<SkillId>();
  readonly #loadedResources = new Map<string, LoadedLocalResource>();
  readonly #records: LocalResourceReadRecord[] = [];
  #readCount = 0;
  #sessionBytes = 0;

  constructor(grant: ReadLocalResourceGrant) {
    if (
      !Number.isInteger(grant.maxFileBytes) ||
      grant.maxFileBytes <= 0 ||
      !Number.isInteger(grant.maxSessionBytes) ||
      grant.maxSessionBytes < grant.maxFileBytes ||
      !Number.isInteger(grant.maxReadCount) ||
      grant.maxReadCount <= 0
    ) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_GRANT_INVALID",
        "本地资源读取额度无效。",
      );
    }
    this.#grant = Object.freeze({
      ...grant,
      skillIds: Object.freeze([...grant.skillIds]),
      allowedMediaTypes: Object.freeze([...grant.allowedMediaTypes]),
    });
    this.#skillIds = new Set(grant.skillIds);
  }

  assertSkillGranted(skillId: SkillId) {
    if (!this.#skillIds.has(skillId)) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_SKILL_DENIED",
        `当前 Agent 未获准读取 Skill：${skillId}`,
      );
    }
  }

  recordRead(input: {
    skillId: SkillId;
    logicalPath: string;
    digest: string;
    bytes: number;
    isSkillEntry: boolean;
    content?: string;
  }) {
    this.#readCount += 1;
    if (this.#readCount > this.#grant.maxReadCount) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_READ_LIMIT_EXCEEDED",
        "本次 Agent Session 的本地资源读取次数已用完。",
      );
    }

    const duplicate = this.#digests.has(input.digest);
    if (!duplicate) {
      if (this.#sessionBytes + input.bytes > this.#grant.maxSessionBytes) {
        throw new AgentResourceError(
          "LOCAL_RESOURCE_SESSION_LIMIT_EXCEEDED",
          "本次 Agent Session 的本地资源读取字节额度不足。",
        );
      }
      this.#sessionBytes += input.bytes;
      this.#digests.add(input.digest);
      if (input.content !== undefined) {
        this.#loadedResources.set(
          input.logicalPath,
          Object.freeze({
            logicalPath: input.logicalPath,
            digest: input.digest,
            content: input.content,
          }),
        );
      }
    }
    if (input.isSkillEntry) {
      this.#activatedSkills.add(input.skillId);
    }

    this.#records.push(
      Object.freeze({
        agentId: this.#grant.agentId,
        workOrderId: this.#grant.workOrderId,
        logicalPath: input.logicalPath,
        digest: input.digest,
        bytes: input.bytes,
        result: duplicate ? "duplicate" : "read",
      }),
    );
    return { duplicate };
  }

  recordDenied(logicalPath: string, code: string) {
    this.#records.push(
      Object.freeze({
        agentId: this.#grant.agentId,
        workOrderId: this.#grant.workOrderId,
        logicalPath,
        result: "denied",
        code,
      }),
    );
  }

  get grant() {
    return this.#grant;
  }

  get activatedSkillIds() {
    return Object.freeze([...this.#activatedSkills]);
  }

  get records() {
    return Object.freeze([...this.#records]);
  }

  get loadedResources() {
    return Object.freeze([...this.#loadedResources.values()]);
  }

  get consumedBytes() {
    return this.#sessionBytes;
  }
}
