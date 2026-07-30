export type PromisePoolResult<Value> =
  | { status: "fulfilled"; value: Value }
  | { status: "rejected"; reason: unknown };

export type PromisePoolOptions = {
  concurrency?: number;
  signal?: AbortSignal;
};

/**
 * 以固定上限消费任务，结果始终与输入顺序一致。单项失败只记录在对应位置，
 * 不会中断其他已启动任务；取消后不再领取新任务。
 */
export async function runPromisePool<Item, Value>(
  items: readonly Item[],
  worker: (item: Item, index: number) => Promise<Value>,
  options: PromisePoolOptions = {},
): Promise<PromisePoolResult<Value>[]> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Promise Pool concurrency 必须是正整数。");
  }

  const results = new Array<PromisePoolResult<Value> | undefined>(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length && !options.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = {
          status: "fulfilled",
          value: await worker(items[index]!, index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => consume(),
    ),
  );

  for (let index = 0; index < items.length; index += 1) {
    results[index] ??= {
      status: "rejected",
      reason: createAbortError(),
    };
  }

  return results as PromisePoolResult<Value>[];
}

function createAbortError() {
  return new DOMException("Promise Pool 已取消。", "AbortError");
}
