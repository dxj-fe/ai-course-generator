export class DefinitionRegistry<
  Id extends string,
  Definition extends Readonly<{ id: Id }>,
> {
  readonly #kind: string;
  readonly #definitions = new Map<Id, Definition>();
  #frozen = false;

  constructor(kind: string) {
    this.#kind = kind;
  }

  register(definition: Definition) {
    this.assertMutable();
    if (this.#definitions.has(definition.id)) {
      throw new Error(`${this.#kind} ID 重复注册：${definition.id}`);
    }
    this.#definitions.set(definition.id, Object.freeze(definition));
    return this;
  }

  get(id: Id) {
    const definition = this.#definitions.get(id);
    if (!definition) {
      throw new Error(`${this.#kind} 未注册：${id}`);
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
      throw new Error(
        `${this.#kind} Registry 已冻结，运行期间不能修改注册项。`,
      );
    }
  }
}
