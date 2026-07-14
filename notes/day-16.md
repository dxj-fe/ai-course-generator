# Day 16：真实图片生成与 HTML 素材集成

## 今日产出

- `AssetRequestSchema` 约束素材类型、用途、Prompt、透明背景、HTML 安全区和宽高比。
- `ImagePromptAgent` 只把 PageContentDSL 的真实 assetSlots 编译成背景、角色贴纸、图标和纹理四类请求。
- 图片 Prompt 统一禁止文字、数字、公式、Logo、水印、按钮、卡片、导航和完整 UI。
- `generateImageAsset` Skill 通过服务端 OpenAI-compatible 图片模型调用真实生图能力，校验 PNG/JPEG/WebP 魔数、大小、基础尺寸和透明格式。
- 已验证图片写入 `.data/generated-assets`，HTML 只获得 `/api/assets/{randomId}` 内部 URI，不接触文件路径或密钥。
- 每一次失败都变成 `css-gradient`、`css-texture`、`inline-svg` 或 `placeholder` fallback；单张图失败不会阻塞 HTML。
- HTML Engineer 只能引用当前页批准的 URI，并必须把所有文字、互动和响应式布局保留为 HTML。
- Page QA 检查素材结果覆盖、真实 URI 引用、可用视觉元素和 fallback 状态。
- Seaca 学习工作区增加页面级 AssetGallery；重新生成 DSL 或素材时会失效下游 HTML 与 QA。

## 关键边界

### 为什么图片保存在服务端并通过内部路由读取？

把 base64 直接嵌进 HTML 会放大模型上下文、HTTP 响应、React 状态和 localStorage 预览记录，也难以独立缓存或失效。把供应商 URL直接交给生成 HTML 又会引入过期、鉴权、追踪和远程资源安全问题。当前实现先验证二进制，再按随机 ID 保存；HTML 只使用同源内部 URI。它保持了 Day 13 的“禁止远程资源”边界，同时让工作区和独立预览复用同一素材。

### 为什么图片失败不能让 HTML 失败？

课程核心价值是可读、可操作的教学内容，图片属于增强层。供应商限流、模型不支持透明通道或输出格式异常都不应让整页丢失。Skill 把技术异常收敛为结构化 fallback；HTML Engineer 仍能使用 StyleTemplate 的颜色、CSS 渐变、纹理、内联 SVG 或可访问占位完成页面。QA 会把降级记录为 warning，用户可以只重试素材，而不必重跑课程内容。

## 复盘与面试题

### 1. 为什么不能直接让图片模型生成整张课程页面？

整页图片把标题、正文、按钮和导航都烘焙成像素，导致文字不可选择、不可被读屏读取、不能随内容更新，也无法保证语义标题、键盘焦点、触控尺寸和表单行为。它在窄屏、字体缩放、语言切换和动态内容下无法可靠重排；模型还经常生成错误文字或伪按钮。安全与质量系统也失去了 blockId、assetSlotId 和 selector 等稳定定位能力。

更稳妥的职责分配是：图片模型生成独立、无文字、可裁切的视觉资产；PageContentDSL 保存内容事实；HTML Engineer 负责语义结构、真实文字、互动、响应式布局和无障碍；StyleTemplate 提供跨页 Token；Page QA 分别检查内容、布局、运行时和素材。这样每一层都能单独缓存、重试、替换和验收。

### 2. 素材 Prompt 和普通插画 Prompt 有什么区别？

普通插画 Prompt 通常只描述“画什么”和“什么风格”，目标是得到一张独立观看时完整的图。素材 Prompt 还必须描述它将如何被 HTML 使用：语义类型、页面用途、比例、透明背景、裁切容忍度、主体位置、文字安全区、视觉密度和禁止内容。背景需要为 HTML 标题保留低细节区域；角色贴纸需要完整轮廓和透明通道；图标要在小尺寸仍可辨认；纹理必须低对比，不能抢正文层级。

素材 Prompt 也不能要求模型生成标题、按钮或卡片，因为这些属于 HTML 的可访问与交互层。本项目让模型只提供创意核心和安全区方向，再由确定性代码补齐透明、比例、无文字、无 UI 等生产约束，避免模型漏掉硬规则。

### 3. 如何验证“透明背景”不是一句没有兑现的 Prompt？

请求层先规定角色贴纸和图标必须 `transparentBackground: true`。结果层检查 MIME 和文件签名：PNG 根据 IHDR color type 判断是否支持 alpha；WebP 当前只能标记为未知，后续可以解析 VP8X alpha bit 做更严格验证。Seedream 4.5 当前返回 JPEG，因此成功图片会保留并记录 `TRANSPARENCY_UNAVAILABLE` 警告，HTML 必须把它放在独立容器中，而不能当作透明贴纸覆盖正文。Prompt 是意图，二进制检查和显式能力警告才是可证明的结果。

### 4. 为什么要区分 `AssetRequest`、`Asset` 和 `AssetGenerationResult`？

`AssetRequest` 是执行意图，记录为什么生成、生成什么和布局约束；`Asset` 是已经可消费的领域实体，保存 URI、MIME、尺寸、alt 和页面反向索引；`AssetGenerationResult` 是一次尝试的审计记录，表达 ready 或 fallback、供应商、模型、耗时和错误码。三者分开后可以重试同一请求、替换供应商、复用成功素材，同时保留失败历史，而不会把失败伪装成可用 Asset。

### 5. 如何防止模型把未批准的图片塞进 HTML？

HTML Prompt 只接收当前页的素材结果。服务端输出校验要求结果无重复地覆盖全部 assetSlots，ready 素材的准确 URI 必须出现在 HTML 中，并拒绝任何不在批准清单中的 `img src`。Day 13 安全预检继续拒绝 HTTP(S) 远程图片和 CSS URL，因此图片模型、HTML 模型和浏览器预览之间都有独立边界。

## 当天结束复盘

1. 四类素材分别需要怎样的透明、比例和安全区约束？
2. 为什么 `AssetGenerationResult.fallback` 仍被工作流视为完成？
3. HTML Engineer 如何证明 ready 素材确实被使用，且没有引入额外图片？
4. 图片二进制为什么要同时检查声明 MIME 和文件魔数？
5. 什么时候应该只重试单张素材，什么时候应该重新生成 Page DSL？
6. 当前 WebP 透明度验证还有什么可加强之处？
7. 为什么 altText 来自 DSL 指导，而不是让图片模型自由生成？
