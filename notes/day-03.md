# Day 03 复盘

## 1. 今天真正理解的概念

- 结构化输出：把模型的自然语言能力约束成前端和后续 Agent 可稳定消费的数据。
- Zod Schema：既提供 TypeScript 类型推导，也在运行时校验模型结果，防止坏数据进入工作流。
- JSON Schema：是模型侧和应用侧共享输出契约的表达方式，能减少字段缺失和格式漂移。
- CourseIntent：不是课程正文，而是后续 Planner Agent 的任务规格。

## 2. 今天完成的代码

- 新增文件：`src/shared/course-schema/intent.ts`
- 新增文件：`src/server/agents/intent-agent.ts`
- 新增文件：`src/app/api/agents/intent/route.ts`
- 新增文件：`src/features/ai-playground/components/json-inspector.tsx`
- 修改文件：`src/server/ai/client.ts`、`src/server/ai/error.ts`
- 修改文件：`src/features/ai-playground/components/ai-playground.tsx`
- 可运行命令：`pnpm lint`、`pnpm build`

## 3. 10 条测试输入与观察点

1. `给 8 岁小朋友做一门太阳系入门课，要有互动问答。`
   - 观察：年龄段应接近儿童，风格应偏 kids-playful 或 sci-fi。
2. `面向前端工程师讲 AI Agent 基础，5 页，中文。`
   - 观察：topic 应聚焦 AI Agent，courseLength 应为 5。
3. `用英文做一个高中生能看懂的 climate change course。`
   - 观察：language 应为 en-US，难度不应过高。
4. `给成年人做垃圾分类培训，不要太幼稚。`
   - 观察：avoid 应包含幼稚表达，visualStyle 不应选择 kids-playful。
5. `我要一门火星探险主题的游戏化课程，必须包含任务奖励。`
   - 观察：visualStyle 应为 game-quest 或 sci-fi，mustInclude 包含任务奖励。
6. `做 12 页古诗入门课，适合小学三年级。`
   - 观察：courseLength 应为 12，年龄段应接近 8-10 岁。
7. `AI 素养课，中英双语，适合非技术管理者。`
   - 观察：language 应为 bilingual，difficulty 应为 beginner。
8. `黑板风格讲解二次函数，避免复杂证明。`
   - 观察：visualStyle 应为 blackboard，avoid 包含复杂证明。
9. `极简风格介绍 TypeScript 类型系统，给初级前端。`
   - 观察：visualStyle 应为 minimal，difficulty 应为 beginner。
10. `自然风格讲植物光合作用，需要包含实验观察。`
    - 观察：visualStyle 应为 nature，mustInclude 包含实验观察。

## 4. 今天遇到的问题

- 问题描述：如果直接让模型返回文本，后续 Planner 需要再解析一遍，字段缺失和枚举漂移会很难定位。
- 根因：自然语言输出没有稳定字段契约，前端无法可靠判断哪些信息可用。
- 解决方案：定义 `CourseIntentSchema`，通过 AI SDK structured output 生成对象，并再次用 Zod 校验。
- 以后如何避免：每个 Agent 输出先定义 schema，再写 prompt 和 route。

## 5. 今天可用于面试的表达

Q：为什么 AI 前端项目通常要使用结构化输出，而不是直接解析模型文本？

A：因为前端和后续 Agent 需要的是稳定数据契约，不是一段看起来合理的文字。结构化输出把模型结果限制到 schema 内，字段缺失、枚举错误、类型错误都能在进入业务流程前被发现。这样 CourseIntent 可以直接交给 Planner Agent，而不是让每一层都猜模型文本的含义。

Q：Zod 在这个项目里解决的是 TypeScript 类型问题，还是运行时可靠性问题？

A：两者都有，但运行时可靠性更关键。TypeScript 只能约束开发期代码，不能保证模型真的返回了合法字段。Zod schema 是 AI 输出进入系统的边界，既能推导 `CourseIntent` 类型，也能在运行时拦截坏数据。

## 6. 明天开始前要确认

- [ ] 主分支可启动
- [ ] README/notes 已更新
- [ ] 没有把 API Key 写入代码
- [ ] 今日产物可以截图或演示
