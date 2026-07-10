# Day 02 复盘

## 1. 今天真正理解的概念

- `messages`：模型不会自动记住历史，多轮对话是应用把历史消息重新传给模型。
- `system prompt`：负责角色、边界和输出风格，不应该混入具体用户任务。
- `temperature`：控制输出随机性，低温更适合稳定工程任务，高温更适合创意发散。
- `traceId`：把一次前端请求、服务端日志和未来 Timeline 事件串起来，方便定位失败。

## 2. 今天完成的代码

- 新增文件：`src/server/ai/client.ts`
- 修改文件：`src/server/ai/error.ts`、`src/server/ai/request.ts`、`src/server/ai/handlers.ts`
- 修改文件：`src/features/ai-playground/components/ai-playground.tsx`、`src/features/ai-playground/lib/messages.ts`
- 可运行命令：`pnpm lint`、`pnpm build`

## 3. 今天遇到的问题

- 问题描述：Day 1 的模型调用直接写在 handler 中，后续 Agent 复用和错误排查会变困难。
- 根因：route handler 同时承担请求解析、模型调用、错误处理和响应拼装。
- 解决方案：抽出 `generateTextSafe`、`streamTextSafe`，统一 traceId、错误分类、超时和最小日志。
- 以后如何避免：新增 AI 能力时先放进 client 或 agent 层，不让 route handler 直接调用模型。

## 4. 今天可用于面试的表达

Q：为什么要把模型调用封装成单独的 client 层？

A：因为 AI 调用不是普通 fetch，它有更高的不确定性和调试成本。client 层统一处理模型配置、messages 转换、system prompt、采样参数、超时、traceId 和错误分类，route handler 只负责 HTTP 输入输出。这样后续 Planner Agent、QA Agent、Repair Agent 都能复用同一套调用边界，错误也能通过 traceId 关联到日志和前端 Timeline。

Q：messages 和“记忆”是什么关系？

A：模型本身不会记住用户上一轮说过什么。所谓多轮记忆，是应用侧保存历史 messages，并在下一次请求时把需要的上下文一起传给模型。是否传、传多少、如何压缩，都是应用架构问题，不是模型自动完成。

## 5. 明天开始前要确认

- [ ] 主分支可启动
- [ ] README/notes 已更新
- [ ] 没有把 API Key 写入代码
- [ ] 今日产物可以截图或演示
