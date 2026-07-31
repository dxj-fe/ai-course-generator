# HTML 预览安全

课程 HTML 是不可信输入，即使由模型生成也必须经过清洗、合同校验和沙箱隔离。

## 生成合同

- 完整标准文档，包含 doctype、`html`、`head`、viewport、内联样式和唯一 `main`。
- `main` 必须声明 `data-page-id`。
- 内容块、素材、互动和运行时目标必须使用 DSL 中的稳定 ID。
- 页面不得引用未批准素材，不得包含外部脚本、事件属性或危险 URL。
- 真实互动由平台运行时接管，模型脚本一律移除。

## 隔离

- 预览与播放器使用 `iframe srcDoc`。
- 学习画布只开放 `allow-scripts`，不开放同源权限、表单提交、弹窗或顶层导航。
- 缩略图不可交互并从键盘导航中移除。
- 宿主通过受控 `postMessage` 接收运行时事件，并校验页面 ID 与事件结构。

## 质量验证

浏览器 QA 在桌面、平板和手机视口检查水平溢出、裁切、零尺寸互动和触控目标。三份证据缺一不可；失败证据必须包含公开原因。

安全实现位于 `src/shared/html-preview`、`src/features/keya/html-preview-frame.tsx` 和 `src/server/infra/browser`。
