# Day 32 · 轻量资料上传与 Reference Pack

## 当天结论

课程生成现在可以接收最多三份、每份不超过 5 MB 的 txt、md 或文本型 PDF。文件先在服务端被转换为稳定 chunks，再生成带 chunk 证据的摘要和关键事实。Planner 决定哪些页面需要哪些 chunks，Page Writer 只能消费该页面已授权的子集。当天没有引入向量数据库、OCR、跨课程知识库或 Day 33 检索。

## 数据流

```text
/chat file input
  → ChatApp controller
  → typed multipart client
  → POST /api/references/parse
  → parseUploadedFileSkill
  → ReferencePackSchema
  → course task record / CourseGenerationState checkpoint
  → Planner PagePlan.usedReferences
  → Page Worker scoped reference context
  → PageContentDSL.usedReferences
  → typed SSE snapshot / controller
  → learning workspace ReferencePanel
```

`ChatComposer` 不调用 API。它只发出文件选择、重试和移除意图，并展示 Controller 给出的 `uploading/ready/error` 状态。上传成功后，附件卡会显示资料摘要、可展开的关键事实、明确的“填写学习目标并发送”提示，以及随状态变化的输入占位文案；原始 chunks 仍不会进入展示组件。Reference Panel 只读取类型化课程状态。Timeline 继续只显示公开 Agent 摘要，不序列化原始 chunks、服务端路径、模型 Prompt 或 chain-of-thought。

## 解析与安全边界

- Route Handler 使用 Node runtime 和 multipart `File`；文件先检查大小、扩展名、MIME，PDF 额外检查 `%PDF-` 文件头。
- txt/md 必须是 UTF-8 且不能包含 NUL 二进制字节；Markdown 当天保留为普通文本，不为未使用的 AST 增加依赖。
- PDF 使用 `pdf-parse` 2.x 的 `PDFParse` API。解析后没有文字时明确说明扫描件暂不支持 OCR。
- 原文规范化后由代码切成最多 24 个、每个最多 1500 字符的 chunks；超出部分设置 `truncated`。
- 模型只能生成 summary/keyFacts。每个 fact 必须引用输入中真实 chunk ID，否则整个 Reference Pack 校验失败。
- 资料内容始终被标记为不可信数据；其中的命令、Prompt 和代码不能覆盖 Planner/Page Writer 合同。

## 为什么暂时不使用 pgvector

当前输入是单次任务内最多三份小资料，所有受控 chunks 都能放入限定上下文。向量数据库会增加 embedding、索引、召回、排序、租户隔离和评估成本，却不能替代文件解析、引用完整性或 Prompt Injection 防护。当出现跨课程复用、大语料无法放入上下文、或需要可量化 top-k 召回时，再在 Day 32 稳定 pack/chunk ID 上增加检索。

## 关键验收

- txt、md、文本型 PDF 可以生成合法 Reference Pack；超限、伪造类型、二进制文本、损坏或扫描 PDF 明确失败。
- 关键事实不能引用不存在的 chunk。
- Reference Pack 从任务创建经过 checkpoint 到 workflow/LangGraph，不因取消或恢复丢失。
- Planner 只能引用真实 pack/chunk；Page Writer 只能引用 Planner 授权子集。
- 无资料任务和旧 checkpoint 继续通过原流程。
- Seaca composer 和 Reference Panel 覆盖上传、解析中、成功、错误、重试、移除、桌面及移动布局。

## 面试题与参考答案

### 1. 轻量 RAG 与完整 RAG 有什么区别？

轻量 RAG 仍包含解析、切分、上下文注入和引用，只是不建立 embedding 索引与语义召回。本项目资料规模受控，直接给 Planner/Page Writer 授权 chunks 更简单、可测试。代价是资料规模增大时上下文成本会上升，届时需要增加检索层。

### 2. 为什么 chunks 由代码切分，摘要由模型生成？

原文引用边界必须确定、可复现，才能持久化、恢复和程序校验；摘要属于语义压缩，更适合模型。若让模型重写 chunks，引用对象本身就可能幻觉。固定字符切分可能打断语义，是轻量 MVP 的主要权衡。

### 3. 如何避免资料中的 Prompt Injection？

文件内容从不进入 system prompt，并被明确标记为不可信数据。Planner/Page Writer 的角色、输出 Schema 和禁止项保持更高优先级；模型输出还要经过 pack/chunk 白名单和 PagePlan 子集校验。模型防护不是唯一边界，确定性校验才是最终权限控制。

### 4. 如何保证引用可追踪？

文件内容产生稳定 pack ID，每个原文片段有连续 chunk ID；keyFacts、PagePlan 和 PageContentDSL 都保存这些 ID。workspace 可以据此显示资料被哪些页面使用。引用存在仍不代表语义必然正确，因此真实模型验收还要检查是否断章取义。

### 5. 为什么上传 API 不写进 React 展示组件？

Composer 只负责文件选择和状态呈现，API 客户端负责 HTTP/Schema，ChatApp Controller 负责附件和任务状态，服务端负责解析与业务规则。这样后续替换传输、增加持久化或 Day 33 检索时，不需要重写 UI 组件。
