# Day 14：HTML Engineer Agent 与独立课程预览

## 今日产出

- 一步 `HtmlEngineerAgent`：输入 PageContentDSL 与 VisualBrief，服务端解析真实 FunctionalTemplate、StyleTemplate 和本页视觉指导。
- 版本化 `html-engineer.system.v1.md` / `html-engineer.user.v1.md`，明确内容、布局、响应式、安全和输出格式。
- `POST /api/pages/generate-html`：只接收结构化下游协议，不接收原始用户 Prompt 或客户端复制的模板。
- 服务端生成后立即执行完整文档合同、安全预检、200,000 字符上限和 DSL 稳定标记检查。
- Seaca `/chat` 逐页 HTML 状态、公开 Agent Timeline、错误重试和右侧安全预览。
- `/preview/[previewId]` 全屏预览：随机 ID、浏览器临时缓存、读取时重新校验、空权限 sandbox。
- 同一 DSL 的 sci-fi、kids-playful、minimal 三风格 Prompt/Registry 回归用例。

## 边界决策

### 输入为什么只有 DSL 和 VisualBrief？

客户端只提交 `content` 与 `visualBrief`。功能模板 ID 来自 DSL，样式模板 ID 来自 VisualBrief，服务端再从 Registry 解析完整模板。这样客户端不能篡改模板约束，HTML Engineer 也不会被原始用户 Prompt 拉回课程规划职责。

### 为什么 Day 14 仍然完全禁用脚本？

当前目标是证明内容正确、布局协调和视觉风格成立。脚本对这个目标不是必要条件，却会扩大 XSS、网络请求、表单和跨上下文通信风险。reveal 使用 `details/summary`，选择题和输入用静态原生控件表达，sandbox 不开放 `allow-scripts` 或 `allow-same-origin`。

### 为什么新增独立预览路由？

右侧工作区适合快速检查单页结果，但 390px 面板不足以验收桌面构图。独立路由提供更接近课程成品的画布，并保留 Seaca 的顶部课程栏和底部页码结构。当前没有后端课程持久化，所以 HTML 不放进 URL，也不伪造永久链接；控制器把已校验文档写入带随机 ID 的临时浏览器缓存，新路由读取后再次验证。

## 复盘与面试题

### 1. 如何系统性约束模型生成 HTML 的质量？

约束必须分层。输入层只允许已通过 Zod 的 DSL 和视觉协议；Prompt 层明确完整文档、响应式、内容保真、禁止项与稳定标记；服务端检查 doctype、head/body、viewport、style、文档长度、脚本与危险能力；浏览器渲染前再次检查；最后通过多视口截图和固定 DSL 风格用例做人工或视觉回归。

Prompt 是概率性约束，校验器和 sandbox 才是确定性边界。只写“请生成高质量页面”无法证明输出稳定，也无法让错误进入 Repair 流程。

### 2. 为什么不能把原始用户 Prompt 继续传给 HTML Engineer？

原始 Prompt 已被 Planner、专业设计 Agent 和 Page Writer 逐层编译成结构化决策。再次传入会产生两套事实来源：模型可能为了响应原话而改标题、补知识或覆盖模板，导致同一个 DSL 无法复现。它还会扩大 Prompt Injection 面积，使表现层 Agent 有机会越权重新规划内容。

### 3. 为什么 HTML 用文本生成而不是 Structured Output？

HTML 本身已经是结构化文本文档。再套 JSON 会引入引号、换行、反斜杠和截断转义问题，同时仍需 HTML 专用验证。这里使用 `generateTextSafe` 获取原始文档，把 `HtmlOutput`、事件和验证结果作为 API 外层结构返回。DSL、CoursePlan 等业务对象仍适合 Structured Output。

### 4. FunctionalTemplate、StyleTemplate 和 VisualBrief 分别负责什么？

FunctionalTemplate 定义页面的教学结构和槽位边界；StyleTemplate 提供跨页面稳定的颜色、排版、间距、表面和装饰 Token；VisualBrief 说明本课程及当前页面如何运用这套视觉语言。三者分离后，同一教学内容可以换风格，同一风格也能覆盖不同页面结构，避免复制出 8×6 套模板。

### 5. 为什么服务端和客户端都要验证生成 HTML？

服务端保护 API 与存储边界，阻止非法文档进入可信状态；客户端保护最终渲染边界，防止浏览器缓存、旧数据或未来接口变更绕过服务端。两层面对不同攻击面。客户端校验不是替代服务端，服务端校验也不能假设前端收到的数据永远未被改变。

### 6. 为什么选择拒绝非法 HTML，而不是静默清洗？

对完整课程文档，静默删除节点可能让标题、答案、反馈或布局缺失，却仍显示“成功”。拒绝会保留明确失败语义，让用户重试或让 Repair Agent 定向修复。`sanitizeHtmlLite` 名称保留自手册，但实现是返回结构化问题的 preflight，不承诺成为完整 sanitizer。

### 7. 如何避免 Page DSL 重新生成后继续展示旧 HTML？

HTML 是 DSL 和视觉方案的派生产物。重新生成专业设计时清空全部 `pageWrites` 和 `pageHtml`；重新生成单页 DSL 时把该页 `pageHtml` 重置为 idle。这样状态机不会把旧 HTML 错配到新内容。后续持久化后可增加输入摘要哈希，进一步验证缓存关联。

### 8. 独立预览为什么不能直接把 HTML 放到查询参数？

完整 HTML 通常很长，URL 会触及长度限制、污染浏览历史和日志，还可能泄露课程内容。Day 14 只把随机 `previewId` 放入路径；缓存记录仍被视为不可信，读取和 iframe 渲染时都会重新校验。未来后端持久化后，ID 应映射到有权限控制的课程版本记录。

## 当天结束复盘

1. Agent 输入对象中是否完全不存在原始用户 Prompt？
2. 同一 DSL 换三种样式时，教学语义是否保持不变？
3. 服务端失败是否能通过公开事件解释，而不暴露私有推理？
4. 重新生成 DSL 或 VisualBrief 后，旧 HTML 是否立即失效？
5. `/chat` 与独立预览是否都继续使用空权限 sandbox？
6. 直接打开失效或被篡改的 previewId 时，页面是否拒绝渲染？
