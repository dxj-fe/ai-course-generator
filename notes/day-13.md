# Day 13：HTML 安全预览与 iframe sandbox

## 今日产出

- 共享 `GeneratedHtmlContract` 校验器。
- 返回结构化拒绝原因的 `sanitizeHtmlLite` 安全预检。
- 从 `PageContentDSL` 生成自包含静态 demo HTML。
- Seaca `/chat` 右侧课程工作区中的 `HtmlPreviewFrame`。
- 合规与恶意 HTML 单元测试，以及安全边界文档。

Day 13 没有实现 HtmlEngineerAgent。今天的确定性 demo 只负责证明“合同校验—安全预检—隔离预览”链路，模型生成高质量 HTML 留到 Day 14。

## 复盘与面试题

### 1. 为什么不能把 AI 生成 HTML 直接传给 `dangerouslySetInnerHTML`？

`dangerouslySetInnerHTML` 会把标记插入 Seaca 主应用 DOM。预览内容将与产品共享样式环境、页面交互边界和源上下文，可能通过事件属性、危险 URL、表单、SVG/CSS 或浏览器解析差异影响宿主页面。某类 `<script>` 通过 `innerHTML` 插入时不执行，并不代表整体输入安全。

iframe 创建独立浏览上下文，`sandbox` 再从该上下文移除脚本、同源、表单、弹窗、下载和顶层导航等能力。因此它提供的是浏览器级隔离，而不是依赖字符串看起来“像安全 HTML”。

### 2. GeneratedHtmlContract 和 sanitizeHtmlLite 为什么必须分开？

Contract 回答“这个页面是否是稳定可消费的完整文档”：有没有 doctype、html/head/body、viewport 和内联样式。安全预检回答“这个页面是否声明了当前策略禁止的能力”：例如外链脚本、事件属性和跳转。

二者失败语义不同，也面向不同修复方。缺 viewport 应由 HTML Engineer 修复输出质量；出现外链脚本则是安全策略违规。把它们混成一个布尔值会让日志、UI 报错和未来 Repair Agent 都无法做定向处理。

### 3. 空的 iframe sandbox 默认限制什么？

只写 `sandbox=""` 而不添加 token，表示应用全部 sandbox 限制。当前页面不能执行脚本、提交表单、打开弹窗、触发下载、导航顶层页面，也不会保留真实同源身份。后续加入 `allow-*` 不是“增强功能开关”，而是在撤销某一项安全限制，因此每个 token 都必须有明确业务理由。

### 4. 为什么 `allow-scripts` 与 `allow-same-origin` 的组合危险？

`allow-scripts` 恢复脚本执行，`allow-same-origin` 恢复真实源身份。对与宿主同源的内容，这会同时恢复主动代码能力和同源访问能力，显著削弱 sandbox 的隔离价值，并可能允许内容操纵自己的嵌入环境。若未来确实需要互动脚本，应优先使用独立预览源、不开放同源能力，并通过窄化且严格校验的 `postMessage` 协议通信。

### 5. 为什么 sanitizeHtmlLite 不能作为真正的 sanitizer？

字符串规则很适合拒绝明显的禁止项并返回清晰错误，但浏览器解析 HTML、SVG、URL 与 CSS 的方式复杂，攻击载荷还可以利用编码、畸形标签和不同解析上下文绕过黑名单。因此 `sanitizeHtmlLite` 只是预检。

真正的安全边界是多层组合：sandbox iframe、严格 CSP、受控资源 allowlist、独立预览域名、输出大小限制，以及在确需清洗时使用经过审计的解析器和 allowlist sanitizer。

### 6. iframe sandbox 和 CSP sandbox 有什么区别？

iframe sandbox 由嵌入方设置，约束某一个嵌套浏览上下文。CSP sandbox 由被加载资源的 HTTP 响应头声明，约束资源自身。CSP 的 sandbox 指令不能通过 HTML 内的 meta 元素生效，所以 Day 13 的 `srcDoc` 预览以 iframe sandbox 为主。

未来如果通过独立 Route Handler 或预览域名返回 HTML，可再用响应头设置 CSP sandbox、`default-src` 和资源 allowlist，形成纵深防御。

### 7. 为什么 Day 13 不直接实现 HtmlEngineerAgent？

今天要验证的是安全预览基础设施。如果同时加入模型 Prompt、HTML 质量生成和预览 UI，失败时无法判断问题来自模型输出、合同规则还是浏览器隔离。使用确定性 demo 能先把安全边界和错误展示测稳定；Day 14 只需替换 HTML 来源，继续复用同一套合同、预检和 iframe。

### 8. `srcDoc` 还有哪些容易忽略的资源风险？

`srcDoc` 文档仍可能解析相对 URL，并可能加载图片、样式等网络资源。sandbox 主要限制页面能力，不等于默认阻断所有网络请求。因此生成合同还需要资源策略：当前禁止外部脚本和样式；后续图片链路必须使用明确的资产来源 allowlist，不能把任意 URL 原样交给预览页。

