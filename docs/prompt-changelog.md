# Prompt Changelog

本文件记录 Specialist Prompt 的可审计合同变化。组合版本格式为 `system/user`。

## 2026-07-16 · Day 24

### Planner · 2.0.1/2.0.0

- 明确列出每个 pageType 推荐的 canonical interactionType，禁止翻译或写成自定义值。
- 对只支持 JSON object mode、未执行 JSON Schema 枚举约束的兼容 Provider，适配层仅将“合法 pageType + 非法或缺失 interactionType”收敛到该页面类型的确定性默认值。
- pageType、页面数量、模板、正文和其余非法字段不会被该规则修复，仍由原 Schema 与业务校验拒绝。

### HTML Engineer · 2.0.1/2.0.0

- 明确 CSS 背景必须把已批准 `Asset.altText` 原样复制到实际 URI consumer 的 `aria-label`，禁止同义改写。
- Agent 适配层会对已经唯一绑定到真实素材槽的 CSS consumer 做机械化可访问属性规范化，再交给原严格校验器复验。
- 该规范化不修复未知 URI、跨槽引用、重复槽位、宽泛选择器或缺失素材绑定，不能绕过原素材合同。

### 八名 active Specialist · 2.0.0/2.0.0

- 统一为 Role、Goal、Inputs、Output Schema、Rules、Forbidden、Examples、Failure Handling 八段结构。
- 明确最小输入和下游 Schema，输入字段中的指令性文字统一视为数据。
- 将职责越界、技术字段生成、原始 Prompt 传播、私有推理和工具调用写入明确禁止项。
- 为输入缺失、合同冲突和结构化输出失败增加一致的 Failure Handling。
- 保留现有 Agent builder、Schema、Workflow 和 Seaca UI 接口。
- Image Prompt 组合版本变化会使已有请求集缓存键自然失效；旧缓存文件无需迁移。

回滚方式：恢复对应 Prompt 正文与 `specialist-library.ts` 中上一组合版本。不得只回滚正文而保留新版本号，也不得只回滚版本号而保留新合同。

### Repair · 0.1.0/0.1.0 draft

- 新增面向未来 Repair 训练日的职责草案。
- 明确只做定向、受预算限制的候选修复，并必须经过相同验证与 re-QA。
- 没有新增 Repair Agent、RepairResultSchema、Workflow 节点或运行时调用。

回滚方式：删除 draft 注册项和两个 Repair 模板；active 运行链路不受影响。
