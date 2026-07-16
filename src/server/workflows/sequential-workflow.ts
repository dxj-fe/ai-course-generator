export type WorkflowValue<State> = {
  name: string;
  key: keyof State;
  select(state: State): unknown;
};

export type WorkflowNodeResult<State, Event> = {
  patch: Partial<State>;
  events: readonly Event[];
};

export type WorkflowNode<
  State,
  Context,
  Event,
  Name extends string = string,
> = {
  name: Name;
  requiredInputs: readonly WorkflowValue<State>[];
  produces: readonly WorkflowValue<State>[];
  run(
    state: Readonly<State>,
    context: Context,
  ): Promise<WorkflowNodeResult<State, Event>>;
};

export class WorkflowNodeError<
  Name extends string = string,
> extends Error {
  constructor(
    readonly nodeName: Name,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowNodeError";
  }
}

export type SequentialWorkflowResult<State, Name extends string> =
  | { status: "completed"; state: State }
  | {
      status: "failed";
      state: State;
      error: WorkflowNodeError<Name>;
    };

type RunSequentialWorkflowOptions<
  State,
  Context,
  Event,
  Name extends string,
  Node extends WorkflowNode<State, Context, Event, Name>,
> = {
  state: State;
  nodes: readonly Node[];
  context: Context;
  merge(state: State, patch: Partial<State>, node: Node): State;
  beforeNode?(state: State, node: Node): Promise<State> | State;
  afterNode?(
    state: State,
    node: Node,
    result: WorkflowNodeResult<State, Event>,
  ): Promise<State> | State;
};

/**
 * 按声明顺序运行固定节点，并把输入检查、输出白名单和状态合并收口在一处。
 * 条件路由、重试和循环不属于这个最小串行运行器。
 */
export async function runSequentialWorkflow<
  State,
  Context,
  Event,
  Name extends string,
  Node extends WorkflowNode<State, Context, Event, Name>,
>({
  state: initialState,
  nodes,
  context,
  merge,
  beforeNode,
  afterNode,
}: RunSequentialWorkflowOptions<
  State,
  Context,
  Event,
  Name,
  Node
>): Promise<SequentialWorkflowResult<State, Name>> {
  let state = initialState;

  for (const node of nodes) {
    try {
      assertValuesPresent(state, node, node.requiredInputs, "input");

      if (beforeNode) {
        state = await beforeNode(state, node);
      }

      const result = await node.run(state, context);
      assertPatchIsDeclared(result.patch, node);

      const merged = merge(state, result.patch, node);
      assertValuesPresent(merged, node, node.produces, "output");
      state = merged;

      if (afterNode) {
        state = await afterNode(state, node, result);
      }
    } catch (error) {
      return {
        status: "failed",
        state,
        error: toWorkflowNodeError(node.name, error),
      };
    }
  }

  return { status: "completed", state };
}

function assertValuesPresent<
  State,
  Context,
  Event,
  Name extends string,
>(
  state: State,
  node: WorkflowNode<State, Context, Event, Name>,
  values: readonly WorkflowValue<State>[],
  kind: "input" | "output",
) {
  const missing = values
    .filter(({ select }) => select(state) === undefined)
    .map(({ name }) => name);

  if (missing.length === 0) return;

  const input = kind === "input";
  throw new WorkflowNodeError(
    node.name,
    input ? "WORKFLOW_NODE_INPUT_MISSING" : "WORKFLOW_NODE_OUTPUT_MISSING",
    `工作流节点 ${node.name} 缺少${input ? "必需输入" : "声明产物"}：${missing.join(", ")}。`,
  );
}

function assertPatchIsDeclared<
  State,
  Context,
  Event,
  Name extends string,
>(
  patch: Partial<State>,
  node: WorkflowNode<State, Context, Event, Name>,
) {
  const allowedKeys = new Set(
    node.produces.map(({ key }) => String(key)),
  );
  const undeclaredKeys = Object.keys(patch).filter(
    (key) => !allowedKeys.has(key),
  );

  if (undeclaredKeys.length === 0) return;

  throw new WorkflowNodeError(
    node.name,
    "WORKFLOW_NODE_UNDECLARED_OUTPUT",
    `工作流节点 ${node.name} 返回了未声明字段：${undeclaredKeys.join(", ")}。`,
  );
}

function toWorkflowNodeError<Name extends string>(
  nodeName: Name,
  error: unknown,
): WorkflowNodeError<Name> {
  if (error instanceof WorkflowNodeError && error.nodeName === nodeName) {
    return error as WorkflowNodeError<Name>;
  }

  return new WorkflowNodeError(
    nodeName,
    "WORKFLOW_NODE_EXECUTION_ERROR",
    `工作流节点 ${nodeName} 执行失败。`,
  );
}
