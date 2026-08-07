# HTML 预览安全

课程 HTML 是不可信输入，即使由模型生成也必须经过清洗、合同校验和沙箱隔离。

## 生成合同

- 完整标准文档，包含 doctype、`html`、`head`、viewport、内联样式和唯一 `main`。
- 新页面不要求作者写 `data-page-id`、内容块标记或布局 DSL；可信运行时验证唯一 `main` 后再补当前 pageId。
- 只有页面确实接入平台互动时才使用受控运行时标记；普通 HTML 结构与样式不需要稳定槽位 ID。
- 页面不得引用未批准素材，不得包含外部脚本、事件属性或危险 URL。
- 真实互动由平台运行时接管，模型脚本一律移除。

## 隔离

- 预览与播放器使用 `iframe srcDoc`。
- 学习画布只开放 `allow-scripts`，不开放同源权限、表单提交、弹窗或顶层导航。
- 缩略图不可交互并从键盘导航中移除。
- 宿主通过受控 `postMessage` 接收运行时事件，并校验页面 ID 与事件结构。

## 质量验证

浏览器 QA 在桌面、平板和手机视口检查水平溢出、真实文字/交互裁切、零尺寸互动、失效按钮、触控目标与纵向阅读长度，并采集 DOM outline、Console、`pageerror`、请求失败和受控互动回放。三份证据缺一不可；缺失、跳过或失败都会阻断交付。学习器允许各视口自然纵向滚动，页面高度与首屏后可达操作只做观测；横向溢出、正文或交互不可达、运行时错误和互动回放失败阻断交付。`overflow:hidden/clip` 中只有真实文字 Range 或交互盒越过边界才算裁切，装饰几何与素材画框越界不误报。

安全实现位于 `src/shared/html-preview`、`src/features/keya/html-preview-frame.tsx` 和 `src/server/infra/browser`。
