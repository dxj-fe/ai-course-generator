# Day 33 · Skill / Template / Reference Retrieval

## 当天结论

项目现在以严格的 `ToolCard`、`SkillCard`、`TemplateCard` 和 `ReferenceHit` 描述 Agent 可查询知识。小型、稳定的 Skill/Template Registry 使用确定性字段检索；单次任务最多三份的 Reference Packs 使用关键词和元数据检索。当天没有引入向量数据库、Embedding 服务、新上传流程或新产品页面。

## 数据流

```text
Skill Registry / Template Registries / task Reference Packs
  → retrieveSkillDocsSkill / retrieveTemplateCardsSkill / retrieveReferenceSkill
  → strict bounded Cards and stable IDs
  → Supervisor / Course Planner
  → existing CourseGenerationState and validated Agent outputs
  → existing public Timeline and learning workspace
```

Planner 仍接收完整的 Functional Template ID/pageType allowlist，以保证开场、讲解、互动和总结结构始终可选；详细语义只提供最多三个相关 Template Cards。Reference 检索不返回原始 chunks，Planner 只看到摘要、关键事实及 pack/chunk ID。Page Writer 随后在服务端按 Planner 授权 ID 解析真实 chunks，因此引用校验和 Day 32 的安全边界保持不变。

Supervisor 的合法节点仍由运行层根据状态、前置输入和预算计算。检索得到的 SkillCard 只帮助解释节点能力及限制，不能添加节点、重置预算或改变条件边。规则优先的 LangGraph Supervisor 在公开决策理由中加入匹配能力名称，但不暴露 Prompt、完整 Registry 或私有推理。

## 为什么不是向量检索

- Skill 和模板数量少、字段稳定，结构化搜索更确定、可解释且容易回归测试。
- Reference Pack 当前被限制为单任务最多三份，稳定 pack/chunk ID 比额外索引更重要。
- 当资料扩展到跨课程、大规模语料且关键词召回不足时，可在现有 ID 合同之上增加 Embedding 或混合检索，而无需修改 UI。

## 安全与上下文边界

- 检索结果均经过严格 Zod Schema，Card 数量与字段长度有明确上限。
- Template Card 不携带 slots、Design Tokens 或完整 Registry 对象。
- Reference Hit 不携带原始 chunk text，只携带可验证 ID 和短事实摘要。
- 完整模板、资料原文、模型 Prompt 和框架原生流数据保持在服务端。
- UI 继续只消费 Controller 提供的类型化课程状态，不直接调用检索 Skill。
