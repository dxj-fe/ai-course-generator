import type { AgentId } from "@/server/agent/ids";

export type AgentExecutionHandler<Request> = (
  request: Request,
) => void | PromiseLike<void>;

/**
 * AgentDefinition 描述能力组合，AgentExecutor 只负责把稳定 AgentId 分派给
 * 已装配的运行实现。业务 Engine 不再 import 或判断具体 Agent。
 */
export class AgentExecutor<Request> {
  readonly #handlers = new Map<
    AgentId,
    AgentExecutionHandler<Request>
  >();
  #frozen = false;

  register(
    agentId: AgentId,
    handler: AgentExecutionHandler<Request>,
  ) {
    this.assertMutable();
    if (this.#handlers.has(agentId)) {
      throw new Error(`Agent 执行器重复注册：${agentId}`);
    }
    this.#handlers.set(agentId, handler);
    return this;
  }

  async execute(agentId: AgentId, request: Request) {
    const handler = this.#handlers.get(agentId);
    if (!handler) {
      throw new Error(`Agent 没有已装配的执行实现：${agentId}`);
    }
    await handler(request);
  }

  has(agentId: AgentId) {
    return this.#handlers.has(agentId);
  }

  freeze() {
    this.#frozen = true;
    return this;
  }

  get frozen() {
    return this.#frozen;
  }

  private assertMutable() {
    if (this.#frozen) {
      throw new Error("Agent Executor 已冻结，运行期间不能替换执行实现。");
    }
  }
}
