import type { AgentId } from "@/server/agent/ids";
import type { AgentDefinition } from "@/server/agent/types/agent";

export class AgentRegistry {
  readonly #definitions = new Map<AgentId, AgentDefinition>();
  #frozen = false;

  register(definition: AgentDefinition) {
    this.assertMutable();
    if (this.#definitions.has(definition.id)) {
      throw new Error(`Agent ID 重复注册：${definition.id}`);
    }
    this.#definitions.set(definition.id, definition);
    return this;
  }

  get(id: AgentId) {
    const definition = this.#definitions.get(id);
    if (!definition) {
      throw new Error(`Agent 未注册：${id}`);
    }
    return definition;
  }

  list() {
    return Object.freeze([...this.#definitions.values()]);
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
      throw new Error("Agent Registry 已冻结，运行期间不能注册或替换 Agent。");
    }
  }
}
