# LangGraph `graph.stream()` 与 `graph.streamEvents()` 详解

本文面向零基础学习者，讲解 LangGraph JavaScript/TypeScript 中 `graph.stream()` 与 `graph.streamEvents()` 的作用、区别、使用方法，以及它们和 SSE 的关系。

## 版本说明

本文以当前项目安装的版本为准：

- `@langchain/langgraph: 1.4.8`
- `@langchain/core: 1.2.3`
- `graph.streamEvents()` 主要使用 `version: "v2"`

最新 LangChain 文档已经开始介绍 `streamEvents(..., { version: "v3" })` 的类型化投影接口，但当前项目依赖的类型声明只支持 `v1` 和 `v2`。学习和开发时，不要混用不同版本的示例。

## 1. 什么是“流”

假设 AI 生成答案需要 10 秒。

使用普通的 `invoke()`：

```ts
const result = await graph.invoke(input);

console.log(result);
```

运行过程类似：

```text
开始 ───────── 等待 10 秒 ───────── 得到最终结果
```

用户在等待期间看不到任何中间结果。

使用流式接口：

```ts
const stream = await graph.stream(input);

for await (const chunk of stream) {
  console.log(chunk);
}
```

过程变成：

```text
开始
  ↓
收到第一块数据
  ↓
收到第二块数据
  ↓
收到第三块数据
  ↓
运行完成
```

这里的 `chunk` 可能是：

- 某个节点刚刚更新的状态
- 当前完整状态
- LLM 新生成的文字片段
- 工具执行进度
- 程序主动发出的业务进度
- 调试事件

因此，“流”不是一种新的 Graph 执行方式。Graph 仍然正常执行，只是在执行过程中不断把信息暴露给调用者。

## 2. `graph.stream()`

`graph.stream()` 主要面向 LangGraph 的运行状态。

它通常回答这个问题：

> Graph 现在生成了什么数据？

基本写法：

```ts
const stream = await graph.stream(
  { topic: "冰淇淋" },
  { streamMode: "updates" },
);

for await (const chunk of stream) {
  console.log(chunk);
}
```

`graph.stream()` 返回异步可迭代对象，所以必须使用：

```ts
for await (const chunk of stream)
```

不能使用普通的 `for...of`：

```ts
for (const chunk of stream)
```

可以将异步迭代理解为：每当 Graph 有一份新数据时，循环就执行一次；暂时没有数据时，循环会异步等待，但不会阻塞整个 Node.js 进程。

### 2.1 Stream Mode 总览

| 模式 | 返回内容 | 类比 |
| --- | --- | --- |
| `updates` | 每一步产生的状态更新 | Git diff |
| `values` | 每一步结束后的完整状态 | 完整文件快照 |
| `messages` | LLM 文字片段与元数据 | 打字机 |
| `custom` | 应用主动发出的自定义数据 | 业务通知 |
| `tools` | 工具调用生命周期 | 工具执行日志 |
| `debug` | 大量底层运行数据 | 调试控制台 |

### 2.2 `updates`：只看本次改了什么

假设 Graph 状态为：

```ts
type State = {
  topic: string;
  outline?: string;
  article?: string;
};
```

Graph 有两个节点：

```text
createOutline → writeArticle
```

节点分别返回：

```ts
// createOutline
return {
  outline: "1. 简介\n2. 原理\n3. 总结",
};

// writeArticle
return {
  article: "这是一篇文章……",
};
```

使用 `updates`：

```ts
const stream = await graph.stream(
  { topic: "人工智能" },
  { streamMode: "updates" },
);

for await (const chunk of stream) {
  console.log(chunk);
}
```

可能依次得到：

```ts
{
  createOutline: {
    outline: "1. 简介\n2. 原理\n3. 总结",
  },
}
```

然后：

```ts
{
  writeArticle: {
    article: "这是一篇文章……",
  },
}
```

这里不会反复返回完整 State，只返回某个节点刚刚提交的更新。

可以把它理解为：

```text
updates = 状态修改记录
```

适合以下场景：

- 显示哪个节点刚完成
- 记录节点执行结果
- 构建工作流进度
- 减少重复传输
- 根据节点名处理不同结果

常见处理方式：

```ts
for await (const chunk of stream) {
  for (const [nodeName, update] of Object.entries(chunk)) {
    console.log("完成节点：", nodeName);
    console.log("节点更新：", update);
  }
}
```

### 2.3 `values`：每次返回当前完整状态

```ts
const stream = await graph.stream(
  { topic: "人工智能" },
  { streamMode: "values" },
);

for await (const state of stream) {
  console.log(state);
}
```

可能依次得到：

```ts
{
  topic: "人工智能",
}
```

然后：

```ts
{
  topic: "人工智能",
  outline: "1. 简介\n2. 原理\n3. 总结",
}
```

最后：

```ts
{
  topic: "人工智能",
  outline: "1. 简介\n2. 原理\n3. 总结",
  article: "这是一篇文章……",
}
```

可以把它理解为：

```text
values = 每一步结束后的完整状态快照
```

如果 State 很大，`values` 会重复发送大量数据。这种情况下通常优先使用 `updates`。

### 2.4 `messages`：获取 LLM 生成片段

`messages` 主要用于让前端看到 AI 逐步生成内容。

```ts
const stream = await graph.stream(
  { topic: "人工智能" },
  { streamMode: "messages" },
);

for await (const [messageChunk, metadata] of stream) {
  if (typeof messageChunk.content === "string") {
    process.stdout.write(messageChunk.content);
  }
}
```

每一项大致包含：

```ts
[
  messageChunk,
  metadata,
]
```

其中：

- `messageChunk`：当前生成的文字或消息片段
- `metadata`：该片段来自哪个 Graph 节点、模型调用，以及具有什么标签

例如，只显示 `writeArticle` 节点生成的内容：

```ts
for await (const [messageChunk, metadata] of stream) {
  if (
    metadata.langgraph_node === "writeArticle" &&
    typeof messageChunk.content === "string"
  ) {
    process.stdout.write(messageChunk.content);
  }
}
```

节点内部即使调用 `model.invoke()`，LangGraph 也可能通过回调系统取得模型的流式片段，不一定要求节点改成 `model.stream()`。

### 2.5 `custom`：主动发送业务进度

有时一个节点正在执行很长的任务，但还没有准备好返回最终 State。

例如：

```text
生成五个课程页面
  页面 1 完成
  页面 2 完成
  页面 3 完成
  页面 4 完成
  页面 5 完成
节点最终返回
```

如果只使用 `updates`，必须等整个节点结束，才能收到节点更新。

这时可以在节点内部使用 `writer`：

```ts
const generatePages = async (state, config) => {
  const pages = [];

  for (let index = 0; index < 5; index += 1) {
    const page = await generateOnePage(index);

    pages.push(page);

    config.writer({
      type: "page_progress",
      completed: index + 1,
      total: 5,
    });
  }

  return { pages };
};
```

调用时启用 `custom`：

```ts
const stream = await graph.stream(input, {
  streamMode: "custom",
});

for await (const progress of stream) {
  console.log(progress);
}
```

可能收到：

```ts
{ type: "page_progress", completed: 1, total: 5 }
{ type: "page_progress", completed: 2, total: 5 }
{ type: "page_progress", completed: 3, total: 5 }
```

可以把 `custom` 理解为：

> 节点还没有执行完，但它主动告诉外部“我现在进行到哪里了”。

它适合传递：

- 百分比进度
- 当前处理的文件名
- 当前生成的课程页面
- 可以公开显示的 Agent 状态
- 中间业务结果
- 非 LangChain 模型产生的文字片段

`custom` 数据结构由应用自己定义，因此最好使用固定 Schema，不要随意发送任意对象。

### 2.6 同时使用多个模式

实际项目经常既需要节点更新，也需要节点内部的细粒度进度：

```ts
const stream = await graph.stream(input, {
  streamMode: ["updates", "custom"],
});

for await (const [mode, chunk] of stream) {
  if (mode === "updates") {
    console.log("节点状态更新：", chunk);
  }

  if (mode === "custom") {
    console.log("业务进度：", chunk);
  }
}
```

当 `streamMode` 是数组时，每一项通常为：

```ts
[mode, chunk]
```

例如：

```ts
[
  "custom",
  {
    type: "page_progress",
    completed: 2,
    total: 5,
  },
]
```

或者：

```ts
[
  "updates",
  {
    generatePages: {
      pages: ["page-1", "page-2"],
    },
  },
]
```

当前项目使用的就是这种方式：

```ts
const stream = await graph.stream(state, {
  signal: context.abortSignal,
  streamMode: ["updates", "custom"],
});
```

职责划分如下：

```text
custom
  → 尽快传递页面级、Agent 级进度

updates
  → 节点结束后收敛正式 Graph 状态
```

这种设计解决了一个典型问题：一个节点内部可能需要生成多个页面，仅等待节点完成会让 UI 长时间没有更新。

## 3. `graph.streamEvents()`

`graph.streamEvents()` 面向的不是业务状态，而是整个 Runnable 执行过程中的生命周期事件。

它通常回答这个问题：

> Graph 内部现在发生了什么？

基本写法：

```ts
const events = await graph.streamEvents(input, {
  version: "v2",
});

for await (const event of events) {
  console.log(event);
}
```

`StateGraph` 编译后得到的 Graph 本身也是一个 LangChain `Runnable`。Graph 中的节点、模型、工具和子链也可能是 Runnable。

因此，`streamEvents()` 可以观察：

```text
Graph 开始
  节点开始
    模型开始
    模型输出片段
    模型结束
  节点结束
Graph 结束
```

事件名通常遵循以下格式：

```text
on_<runnable_type>_<start|stream|end>
```

例如：

```text
on_chain_start
on_chain_stream
on_chain_end

on_chat_model_start
on_chat_model_stream
on_chat_model_end

on_tool_start
on_tool_end
```

### 3.1 事件结构

`v2` 事件大致具有以下结构：

```ts
{
  event: "on_chat_model_stream",
  name: "ChatOpenAI",
  run_id: "当前 Runnable 的运行 ID",
  parent_ids: ["父运行 ID"],
  tags: [],
  metadata: {},
  data: {
    chunk: messageChunk,
  },
}
```

主要字段：

| 字段 | 含义 |
| --- | --- |
| `event` | 发生了什么事件 |
| `name` | 哪个 Runnable 产生了事件 |
| `run_id` | 当前这次执行的唯一 ID |
| `parent_ids` | 父级执行链路，用于恢复调用关系 |
| `tags` | 自定义标签 |
| `metadata` | 节点名等附加信息 |
| `data` | 事件的实际数据 |

`data` 会随事件类型发生变化。

开始事件通常类似：

```ts
{
  event: "on_chain_start",
  data: {
    input: {
      topic: "人工智能",
    },
  },
}
```

流式事件通常类似：

```ts
{
  event: "on_chat_model_stream",
  data: {
    chunk: messageChunk,
  },
}
```

结束事件通常类似：

```ts
{
  event: "on_chain_end",
  data: {
    output: {
      article: "最终文章",
    },
  },
}
```

不要假设每种事件都有相同的 `data` 结构。应先判断 `event.event`，再读取对应字段。

### 3.2 `run_id` 与 `parent_ids`

假设执行关系为：

```text
Graph
└── writeArticle 节点
    └── ChatOpenAI
```

每一层都有自己的 `run_id`：

```text
Graph run_id:       graph-001
Node run_id:        node-002
Model run_id:       model-003
```

模型事件可能包含：

```ts
{
  run_id: "model-003",
  parent_ids: ["graph-001", "node-002"],
}
```

由此可以知道：

```text
model-003 属于 node-002
node-002 又属于 graph-001
```

这对于以下场景非常重要：

- LangSmith 链路追踪
- 调试嵌套 Graph
- 区分并行节点
- 区分多个模型调用
- 构建运行时间线
- 分析哪个工具或节点失败

### 3.3 过滤事件

`streamEvents()` 产生的事件可能很多，因此通常不应该把所有事件直接传给前端。

只处理模型文字：

```ts
const events = await graph.streamEvents(input, {
  version: "v2",
});

for await (const event of events) {
  if (event.event !== "on_chat_model_stream") {
    continue;
  }

  const chunk = event.data.chunk;

  if (typeof chunk.content === "string") {
    process.stdout.write(chunk.content);
  }
}
```

只观察工具：

```ts
for await (const event of events) {
  if (event.event === "on_tool_start") {
    console.log("工具开始：", event.name);
  }

  if (event.event === "on_tool_end") {
    console.log("工具完成：", event.name);
  }
}
```

还可以通过配置提前过滤：

```ts
const events = await graph.streamEvents(input, {
  version: "v2",
  includeNames: ["writeArticle"],
});
```

常见过滤条件包括：

```ts
{
  includeNames: ["writeArticle"],
  includeTypes: ["chat_model"],
  includeTags: ["public-output"],
}
```

具体可用字段与当前 `@langchain/core` 版本有关，应以 TypeScript 自动补全和当前版本的类型声明为准。

## 4. `stream()` 和 `streamEvents()` 的核心区别

| 对比 | `graph.stream()` | `graph.streamEvents()` |
| --- | --- | --- |
| 主要观察对象 | Graph 输出和状态 | Runnable 生命周期 |
| 核心问题 | 产生了什么数据 | 内部发生了什么 |
| 数据量 | 相对精简 | 通常很多 |
| 常见内容 | State、token、业务进度 | start、stream、end、运行 ID |
| 层级 | 偏 Graph/Pregel | Graph、节点、模型、工具、子链 |
| 前端业务 UI | 通常更合适 | 通常需要大量过滤 |
| 调试和追踪 | 能做一部分 | 更合适 |
| 自定义进度 | `writer` + `custom` | `dispatchCustomEvent()` |
| 当前项目选择 | 已用于产品数据流 | 未作为产品主数据流 |

可以使用餐厅进行类比：

```text
graph.stream()
= 服务员不断把已经做好的菜端给你

graph.streamEvents()
= 观察厨房内部：
  厨师开始切菜
  烤箱启动
  厨师开始炒菜
  某道菜装盘
  厨房结束订单
```

如果只想让用户看到课程生成进度，通常不需要把整个厨房的所有动作都暴露出来。

## 5. `custom` 与自定义 Event 的区别

这是初学者最容易混淆的地方。

### 5.1 `graph.stream()` 的 `custom`

发送方式：

```ts
const node = async (state, config) => {
  config.writer({
    type: "progress",
    value: 50,
  });

  return {};
};
```

接收方式：

```ts
graph.stream(input, {
  streamMode: "custom",
});
```

这是 LangGraph 的 Graph stream channel。

### 5.2 `graph.streamEvents()` 的自定义事件

在当前 `v2` 接口中，可以使用：

```ts
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

await dispatchCustomEvent("progress_event", {
  value: 50,
});
```

接收：

```ts
const events = await graph.streamEvents(input, {
  version: "v2",
});

for await (const event of events) {
  if (event.event === "on_custom_event") {
    console.log(event.name);
    console.log(event.data);
  }
}
```

两者目的相似，但属于不同协议：

```text
config.writer()
  → graph.stream()
  → streamMode: "custom"

dispatchCustomEvent()
  → graph.streamEvents()
  → event: "on_custom_event"
```

不要在代码中把这两套机制当作同一个东西。

## 6. 它们和 SSE 的关系

`graph.stream()` 和 `graph.streamEvents()` 都不是浏览器 SSE。

它们是服务端 JavaScript 内部的异步数据流。SSE 是一种 HTTP 传输方式：

```text
LangGraph 流
    ↓
服务端筛选、验证、转换
    ↓
SSE 消息
    ↓
浏览器 EventSource / fetch
    ↓
React UI
```

错误理解：

```text
graph.stream() === SSE
```

正确理解：

```text
graph.stream()
= 服务端的数据来源

SSE
= 把数据从服务端送到浏览器的运输方式
```

例如：

```ts
const stream = await graph.stream(input, {
  streamMode: ["updates", "custom"],
});

for await (const [mode, chunk] of stream) {
  const publicEvent = mapToPublicEvent(mode, chunk);

  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify(publicEvent)}\n\n`),
  );
}
```

生产环境不应该直接将原始 `chunk` 序列化后发送给浏览器，因为它可能包含：

- 完整 Prompt
- 模型输入
- 工具参数
- 内部状态
- 调试信息
- 不稳定的框架字段
- 不应该公开的数据

更安全的做法是：

```text
原始流
  → 白名单映射
  → Schema 校验
  → 公开事件
  → SSE
```

当前项目已经明确采用这层边界，参见 `notes/langgraph-streaming.md`。

## 7. 如何选择

### 7.1 使用 `graph.stream()`

如果需求是：

- 显示 Graph 节点进度
- 获取状态更新
- 流式显示模型文字
- 显示课程页面生成进度
- 获取工具生命周期
- 构建面向最终用户的 UI
- 控制发送给前端的数据结构

推荐：

```ts
graph.stream(input, {
  streamMode: ["updates", "custom"],
});
```

如果主要是聊天文字：

```ts
graph.stream(input, {
  streamMode: "messages",
});
```

### 7.2 使用 `graph.streamEvents()`

如果需求是：

- 调试 Graph 内部执行
- 观察模型、工具、节点的开始和结束
- 分析嵌套调用关系
- 通过 `run_id` 建立调用树
- 记录完整执行时间线
- 构建 tracing 或监控系统
- 精确观察某类 Runnable

推荐：

```ts
graph.streamEvents(input, {
  version: "v2",
});
```

### 7.3 两者都不需要

如果只关心最终结果，使用：

```ts
const result = await graph.invoke(input);
```

这是最简单、最容易维护的选择。不是所有 Graph 都需要 streaming。

## 8. 错误处理与取消

流在执行过程中仍然可能失败：

```ts
try {
  const stream = await graph.stream(input, {
    streamMode: "updates",
  });

  for await (const chunk of stream) {
    console.log(chunk);
  }
} catch (error) {
  console.error("Graph 执行失败", error);
}
```

如果节点中途抛出异常：

- `for await` 循环会抛出异常
- 后续 chunk 不再到达
- 已经收到的 chunk 不会自动撤销
- 不能因为收到过一些数据，就认为任务最终成功

因此，前端协议通常需要明确区分：

```ts
type PublicEvent =
  | { type: "progress"; message: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string }
  | { type: "completed" };
```

取消可以通过 `AbortSignal` 实现：

```ts
const controller = new AbortController();

const stream = await graph.stream(input, {
  signal: controller.signal,
  streamMode: "updates",
});

// 用户点击取消
controller.abort();
```

当前项目已经把 `context.abortSignal` 传入 `graph.stream()`。

## 9. 常见错误

### 9.1 忘记使用 `for await`

错误：

```ts
const result = await graph.stream(input);
console.log(result);
```

这里打印的是流对象，不是最终业务结果。

正确：

```ts
const stream = await graph.stream(input);

for await (const chunk of stream) {
  console.log(chunk);
}
```

### 9.2 多模式时按单模式解析

错误：

```ts
for await (const chunk of await graph.stream(input, {
  streamMode: ["updates", "custom"],
})) {
  console.log(chunk.createOutline);
}
```

多模式返回的是 `[mode, chunk]`。

正确：

```ts
for await (const [mode, chunk] of await graph.stream(input, {
  streamMode: ["updates", "custom"],
})) {
  console.log(mode, chunk);
}
```

### 9.3 把 `updates` 当成完整状态

收到：

```ts
{
  writeArticle: {
    article: "文章内容",
  },
}
```

不代表 State 中只有 `article`。它只表示 `writeArticle` 节点刚刚更新了 `article`。

### 9.4 认为 token 到达就表示节点成功

模型可能已经输出一半文字，然后网络失败。

```text
收到 token ≠ Graph 成功
收到 update ≠ 整个 Graph 成功
收到明确的 terminal/completed 事件 = Graph 成功
```

### 9.5 把原始 `streamEvents()` 全部发送给浏览器

这会带来：

- 隐私风险
- 协议不稳定
- 数据量过大
- 前端与 LangChain 内部实现强耦合

应先转换成应用自己的公开事件。

### 9.6 混用 `streamEvents` v2 和 v3 示例

当前项目应使用：

```ts
const events = await graph.streamEvents(input, {
  version: "v2",
});

for await (const event of events) {
  console.log(event.event);
}
```

最新官方文档中的 v3 示例可能写成：

```ts
const run = await graph.streamEvents(input, {
  version: "v3",
});

for await (const message of run.messages) {
  // ...
}
```

这是不同版本的返回模型。当前项目不能直接照搬 v3 示例；需要先升级依赖，并确认类型和运行行为。

## 10. 一句话记忆

```text
invoke
= 等待最终答案

stream
= 持续接收 Graph 产生的数据

streamEvents
= 持续观察 Graph 内部发生的事件

SSE
= 把筛选后的数据传给浏览器
```

对于当前课程生成项目，`graph.stream({ streamMode: ["updates", "custom"] })` 是更合适的产品数据来源：

- `updates` 负责正式状态收敛
- `custom` 负责页面和 Agent 的细粒度实时进度
- `streamEvents()` 更适合作为调试、追踪和运行分析工具

## 参考资料

- [LangGraph Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [LangGraph Event Streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [JavaScript `streamEvents` API Reference](https://reference.langchain.com/javascript/langchain-core/runnables/RunnableWithMessageHistory/streamEvents)
- 当前项目实现：`src/server/langgraph/course-generation/run-course-graph.ts`
- 当前项目流式边界说明：`notes/langgraph-streaming.md`
