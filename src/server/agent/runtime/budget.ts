export type ToolBudgetReservation = {
  costUnits: number;
  sequence: number;
  toolName: string;
};

export type ToolBudgetSnapshot = {
  maxCostUnits: number;
  maxToolCalls: number;
  remainingCostUnits: number;
  remainingToolCalls: number;
  reservedCostUnits: number;
  reservedToolCalls: number;
};

export class AgentBudgetExceededError extends Error {
  readonly code = "AGENT_TOOL_BUDGET_EXCEEDED";

  constructor(
    message: string,
    readonly snapshot: ToolBudgetSnapshot,
  ) {
    super(message);
    this.name = "AgentBudgetExceededError";
  }
}

/**
 * 单个 Agent Run 内的同步预算闸门。
 *
 * AI SDK 可能在同一步并行执行多个工具。reserve 在第一次 await 之前同步完成检查和
 * 扣减，因此同一事件循环里的并发调用不会先各自读到旧余额再一起超卖。
 */
export class AtomicBudgetMeter {
  private reservedCostUnits = 0;
  private reservedToolCalls = 0;

  constructor(
    private readonly limits: {
      maxCostUnits?: number;
      maxToolCalls: number;
    },
  ) {
    assertPositiveInteger(limits.maxToolCalls, "maxToolCalls");
    if (limits.maxCostUnits !== undefined) {
      assertPositiveInteger(limits.maxCostUnits, "maxCostUnits");
    }
  }

  reserve(toolName: string, costUnits = 1): ToolBudgetReservation {
    if (!toolName.trim()) {
      throw new TypeError("toolName 不能为空。");
    }
    assertPositiveInteger(costUnits, "costUnits");

    const nextToolCalls = this.reservedToolCalls + 1;
    const nextCostUnits = this.reservedCostUnits + costUnits;
    const maxCostUnits = this.limits.maxCostUnits ?? this.limits.maxToolCalls;

    if (
      nextToolCalls > this.limits.maxToolCalls ||
      nextCostUnits > maxCostUnits
    ) {
      throw new AgentBudgetExceededError(
        `工具预算已耗尽，拒绝执行 ${toolName}。`,
        this.snapshot(),
      );
    }

    this.reservedToolCalls = nextToolCalls;
    this.reservedCostUnits = nextCostUnits;

    return {
      costUnits,
      sequence: nextToolCalls,
      toolName,
    };
  }

  snapshot(): ToolBudgetSnapshot {
    const maxCostUnits = this.limits.maxCostUnits ?? this.limits.maxToolCalls;

    return {
      maxCostUnits,
      maxToolCalls: this.limits.maxToolCalls,
      remainingCostUnits: maxCostUnits - this.reservedCostUnits,
      remainingToolCalls:
        this.limits.maxToolCalls - this.reservedToolCalls,
      reservedCostUnits: this.reservedCostUnits,
      reservedToolCalls: this.reservedToolCalls,
    };
  }
}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} 必须是正整数。`);
  }
}
