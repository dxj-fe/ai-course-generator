# 首页精选课程推荐 Design QA（2026-07-30）

## Evidence

- Source visual truth: `/Users/eeo/.codex/generated_images/019fb0c5-df59-7f33-a249-6f170a90a063/call_lVX98BayLsYNPryGvkN7JKQg.png`
- Source pixels: `1487 × 1058`，按 `1×` 处理。
- Browser-rendered implementation: `/Users/eeo/Projects/ai-course-generator/design-qa-home-1440x1024-final.png`
- Implementation viewport: `1440 × 1024` CSS pixels，按 `1×` 处理。
- State: `/` 首页；默认推荐批次展示数学、语文、英语三门课程；一张主推卡和两张辅助卡。
- Density normalization: 源图与实现宽高比均约为 `1.406`；组合对比中分别等比缩放到 `730 × 520`，未加入浏览器外框或额外裁切。
- Full-view comparison: `/Users/eeo/Projects/ai-course-generator/design-qa-comparison-full-final.png`
- Focused course-region comparison: `/Users/eeo/Projects/ai-course-generator/design-qa-comparison-courses-final.png`
- Mobile evidence:
  - `/Users/eeo/Projects/ai-course-generator/design-qa-home-mobile-390x844.png`
  - `/Users/eeo/Projects/ai-course-generator/design-qa-home-mobile-courses-390x844.png`
  - `/Users/eeo/Projects/ai-course-generator/design-qa-home-mobile-supporting-390x844.png`

## Findings

- 未发现仍需处理的 P0、P1 或 P2 问题。
- [P3] 实现保留了现有 Keya 设计系统的“课程灵感”眉题，源图只使用更轻量的萌芽标记。该差异不会改变信息层级，并让首页与现有产品语言保持一致，因此作为有意偏差保留。
- [P3] 三张课程图片为针对实际推荐内容生成的独立高清资产，构图和题材与源图一致，但不是从组合稿中裁出的像素副本。由于源稿没有可复用的单张原始素材，这一差异符合资产质量与可维护性要求。

## Required fidelity surfaces

- Fonts and typography: 沿用项目现有中文无衬线字体栈；标题、正文、标签和元信息的字重、字号、行高及截断层级与源图一致。课程标题在桌面和 `390px` 宽度下均无破坏性换行或溢出。
- Spacing and layout rhythm: 桌面首屏保持 `96px` 内容边距、一主两辅卡片网格、`24–26px` 圆角和轻量投影；精选区底边为约 `1002px`，完整落在 `1024px` 视口内。移动端改为纵向堆叠，根节点 `clientWidth` 与 `scrollWidth` 均为 `390px`。
- Colors and visual tokens: 继续使用 Keya 的米白、浅芽绿、深森林绿与低对比边框；渐变、阴影和交互色均复用当前视觉体系，文字对比清晰。
- Image quality and asset fidelity: 三张首批图片均为独立 `1600 × 900` JPEG；题材、裁切和色调分别对应函数山路、《论语》书卷与英语对话。iframe 预览不使用占位图、CSS 插画、emoji 或手工 SVG，并通过 sandbox/CSP 隔离。
- Copy and content: “本周精选”“先看看一门好课可以长成什么样”“换一批灵感”与源设计意图一致；课程主题、摘要、页数、时长和生成提示相互一致，并能独立解释产品能力。
- Icons and affordances: 使用项目既有 Lucide 图标体系；换批、页数、时长和进入课程的方向提示具有一致线宽、对齐和可见焦点。
- Responsiveness and accessibility: `390 × 844` 下无横向溢出，主推卡与辅助卡按阅读顺序堆叠；按钮、链接、区块标题、live region、iframe 隐藏语义和 reduced-motion 处理完整。

## Primary interactions tested

1. 浏览器点击“换一批灵感”后，主推课程从“看懂函数的变化”切换为“天空为什么会变色”，并进入 `/?recommendationCursor=3`；正常 hydration 状态使用推荐 API 无刷新更新，原生 GET 表单作为脚本未就绪时的渐进增强兜底。
2. 浏览器点击主推卡“查看课程”后进入 `/chat`，URL 携带完整课程生成 prompt 和 `source=recommendation`。
3. 在 `390 × 844` 视口滚动检查主推卡和两张辅助卡，布局、裁切、点击目标及阅读顺序正常。
4. 推荐 API 客户端、Route Handler、四个批次轮换、十二领域覆盖和预览 HTML 均有自动化测试。
5. 桌面初始状态、换批后状态与移动端状态的浏览器控制台 error/warn 均为 `0`。

## Comparison history

1. 首轮截图 `/Users/eeo/Projects/ai-course-generator/design-qa-home-1440x1024-v1.png` 发现精选课程整体落到首屏以下，属于 P1 的主要区域比例偏差；课程 iframe 内的重复标题被裁切，属于 P2 的内容密度问题。
2. 缩短桌面 hero 的上下留白、将精选区桌面顶部间距调整为 `32px`，并在卡片缩略宽度下隐藏预览 HTML 的文字叠层，仅保留真实封面资产。
3. 中间截图 `/Users/eeo/Projects/ai-course-generator/design-qa-home-1440x1024-v2.png` 暴露旧 iframe 缓存和进场动画的瞬时状态；预览 URL 增加版本参数后重新捕获。
4. 最终截图与源图在同一组合输入中复核；一主两辅结构、首屏比例、图片质量、字体、间距、颜色和文案均无剩余 P0/P1/P2 差异。

## Implementation checklist

- [x] 首页改为一张主推课程与两张辅助课程。
- [x] 推荐课程由后端注册表和 API 提供，每批三门。
- [x] 十二个领域均至少包含一门高质量课程。
- [x] “换一批灵感”支持 API 无刷新更新及原生 GET 兜底。
- [x] 每门课程提供高质量生成 prompt、结构化大纲和 sandboxed HTML 预览。
- [x] 桌面、移动端、控制台、自动化测试和生产构建通过。

final result: passed

---

# 课芽课程简报选中态与动态章节 Design QA

## Evidence

- Source visual truth: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-561a1835-67ea-4de2-9e0b-42f493ab16dc.png`
- Source pixels: `1562 × 1066`, treated as 1×.
- Intended state: `/chat` 课程简报处于“修改”状态；“初学者”和“讲解 + 互动”已选中；固定 3、4、5 节选项已移除，内容显示由课芽按内容深度规划。
- Local implementation URL prepared for capture: `http://127.0.0.1:4173/chat`.
- Browser-rendered implementation screenshot: unavailable.
- Viewport and density normalization: unavailable because the in-app browser rejected the local preview URL under its URL security policy.

## Findings

- [P0] 缺少浏览器渲染证据，无法完成最终视觉对比。
  - Location: `/chat` 课程简报编辑区。
  - Evidence: source screenshot was opened at original resolution, but the in-app browser could not load the local implementation, so no same-state implementation capture or combined comparison image exists.
  - Impact: typography、间距、选中态颜色、控件换行和实际交互无法按截图到代码流程宣告视觉验收通过。
  - Fix: 在允许访问本地预览的浏览器中打开 4173 端口，进入课程简报修改状态，选择“初学者”和“讲解 + 互动”，再按相同裁切捕获并比较。

## Required Fidelity Surfaces

- Fonts and typography: code沿用现有课芽字体、字号和权重 token；缺少浏览器截图，未完成视觉确认。
- Spacing and layout rhythm:保留原卡片、字段栅格和编辑区节奏，移除固定课程节数组；缺少渲染证据。
- Colors and visual tokens:选中项使用现有 sprout green、浅绿底和清晰边框；未完成像素级确认。
- Image and asset fidelity:该区域没有内容图片；图标继续使用项目已有 Lucide 图标体系。
- Copy and content:自动结构文案改为“由课芽按内容深度规划”，不再展示 3–5 节固定范围。
- Interaction and accessibility:受众与学习方式改为受控原生 radio，具备 checked、组内互斥和键盘语义；组件测试已覆盖两个选中值。

## Comparison History

1. Source inspection identified two actionable requirements: selected controls were visually indistinguishable, and the fixed 3–5-section row conflicted with backend-driven planning.
2. Implementation changed presets to controlled native radios with green selected treatment and removed the fixed section-count selector.
3. Post-fix browser capture was attempted on `http://127.0.0.1:4173/chat`, but the in-app browser blocked the local URL; no valid post-fix visual evidence could be produced.

## Focused-region comparison

The source course-brief region was inspected at `1562 × 1066`. A matching implementation crop could not be captured, so no combined comparison input was available.

## Primary interactions tested

- Automated component rendering confirms exactly two checked radio values: `初学者` and `mixed`.
- Automated model tests confirm automatic section planning is non-blocking and explicit `8`/`12` sections remain supported.
- Browser click, focus, responsive wrapping, and console checks were blocked by local URL access policy.

## Implementation Checklist

- [x] 明确受众与学习方式的选中态。
- [x] 使用原生 radio 语义和键盘行为。
- [x] 移除固定 3、4、5 节选择。
- [x] 自动模式等待真实后端 Outline，不伪造 5 节草稿。
- [ ] 在可访问本地预览的浏览器中完成同状态截图、控制台检查和视觉对比。

final result: blocked

---

# 课程播放器 Design QA（2026-07-27）

## Evidence

- Source visual truth: `/Users/eeo/.codex/generated_images/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/call_V7xBSJO8w2otmO4c4R1fi8pl.png`
- Source pixels: `1487 × 1058`, treated as 1×.
- Intended state: `/course/[courseId]`；讲解模式；目录折叠；字幕开启；缩略图展开；当前第 1 / 5 页。
- Browser-rendered implementation: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-qa-desktop.jpg`
- Implementation viewport: `1440 × 1000`, 1×.
- Combined full-frame comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-comparison.jpg`
- Narrow-screen verification: `390 × 844`；DOM 几何确认页面宽度 `390px`，画布/控制区/缩略图区均为 `366px`，无横向或页面级纵向溢出。

## Full-frame comparison

- 页面结构与参考稿一致：顶部课程信息和模式切换、折叠课程轨道、主 HTML 画布、画布内字幕与全屏、独立控制行、可收起的编号缩略图导航。
- 顶栏学习进度已移除；模式切换保持居中。
- 控制行与画布有明确留白，上一页/播放/下一页居中，字幕、倍速和缩略图开关独立位于右侧。
- 缩略图仅显示两位编号，不显示标题；当前页使用课芽绿色描边。

## Focused findings

- [P2] 验收截图中的太阳系课程是旧生成记录，图片仍包含旧版生成文字伪影，且其 HTML 高度来自此前“允许长页滚动”的合同，因此画布内留白与裁切不代表新生成结果。
  - Fix applied: 新课程的 Intent、Planner、Page Writer、HTML Engineer 与 Page QA 已统一为固定画布无滚动合同；Playwright QA 会拒绝文档和嵌套纵向溢出，内容超预算时在规划阶段拆页。
- 未发现播放器壳层的 P0/P1 视觉或交互问题。
- 浏览器控制台 error 数量：`0`。

## Primary interactions tested

1. 展开/收起桌面课程目录。
2. 展开/收起底部缩略图，收起后导航区域从 DOM 移除。
3. 编号缩略图导航与当前页语义。
4. 讲解/自学模式切换；自学模式下字幕和播放速度正确禁用。
5. 进入/退出画布全屏。
6. `390 × 844` 下打开/关闭移动端课程目录。
7. HTML iframe 保持单实例、`sandbox="allow-scripts"`、无 `allow-same-origin`，并设置 `scrolling="no"`。

## Comparison history

1. 首轮实现完成播放器结构和全部交互，并在真实 5 页太阳系课程上验收。
2. 根据组合对比调整模式切换的桌面尺寸，使顶部视觉重心更接近参考稿。
3. 重新截图并复核桌面、全屏、目录、缩略图、自学模式与窄屏边界；最终控制台无错误。

final result: passed

---

# 课程地图长标题与 Tooltip Design QA（2026-07-28）

## Evidence

- Source visual truth: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-7bf83e17-27dd-434c-965f-93da3795aaca.png`
- Source pixels: `3014 × 1794`；参考重点为展开状态的左侧课程地图。
- Browser-rendered implementation:
  - `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-sidebar-overflow-normal.png`
  - `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-sidebar-overflow-tooltip.png`
- Implementation viewport: `1280 × 720` CSS pixels，DPR `1`。
- State: `/course/course-0666e2b2-960b-47c0-a8d1-ccc08fa2d190`；课程地图展开；当前第 1 节；长标题处于普通态和 hover 态。
- Combined comparison evidence: source and hover-state implementation were opened together in one visual comparison input; focused comparison used the complete left sidebar rather than the differently sized course canvas.

## Findings and fixes

1. 首轮浏览器测量发现课程条目所在 Grid 轨道受单行标题的最小内容宽度撑开：侧栏 `nav` 为 `279px`，条目按钮却达到 `304.84px`，因此标题不是在条目内省略，而是由侧栏外层直接裁掉。
2. 将列表轨道改为 `minmax(0, 1fr)`，并为列表项和按钮补齐 `min-width: 0`。修复后按钮为 `255px`，侧栏 `scrollWidth/clientWidth` 均为 `279px`，不再产生横向溢出。
3. 最长标题的可视宽度为 `191px`、实际内容宽度为 `241px`；最终呈现单行省略号，hover 后在侧栏右侧显示完整中文标题。
4. Tooltip 只在 `scrollWidth > clientWidth` 时挂载；短标题 hover 不显示多余提示。字体加载、窗口变化和容器尺寸变化都会重新测量。
5. 未完成章节使用 `aria-disabled` 和点击守卫，保持不可导航，同时保留 hover/focus Tooltip 能力。

## Required fidelity surfaces

- Fonts and typography: 沿用课芽现有 `text-sm/font-medium` 标题层级；单行 `nowrap + ellipsis`，Tooltip 使用紧凑 `12px/20px` 文本。
- Spacing and layout rhythm: 状态图标固定宽度，文本列在剩余空间内收缩；列表圆角、行高、间距和当前项浅米色背景保持不变。
- Colors and visual tokens: Tooltip 使用播放器既有深棕色，与底部缩略图控制和现有提示风格一致。
- Image quality and asset fidelity: 本次没有新增图片资产；课程 HTML 画布和已有图标均未改变。
- Copy and content: DOM 和 Tooltip 均保留完整课程标题，不截断数据本身。
- Accessibility: Tooltip Trigger 覆盖整行按钮，支持鼠标 hover 与键盘 focus；不可用章节通过 `aria-disabled` 正确表达状态。

## Primary interactions tested

1. 展开课程目录并检查 7 个章节的标题布局。
2. 长标题 hover 显示完整 Tooltip。
3. 短标题 hover 不显示 Tooltip。
4. 生成中/失败章节保持不可导航，并继续暴露完整无障碍标题。
5. 浏览器控制台 error/warn 数量为 `0`。

## Comparison history

1. 初始实现仅添加 `truncate`，真实浏览器显示 Grid 轨道仍被标题撑宽。
2. 修复 Grid、列表项和按钮的最小宽度后重新测量，侧栏横向溢出归零，长标题开始正确省略。
3. 重新捕获普通态和 hover 态；Tooltip 完整、未遮挡状态文字，短标题无冗余提示，未发现剩余 P0/P1/P2 问题。

final result: passed

---

# 首页与我的课程 HTML 封面 Design QA（2026-07-27）

## Evidence

- Source visual truth:
  - `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-58494dcc-b075-4a31-ae97-5ca023da7bc1.png`
  - `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-d2b6d1ad-9ca6-49da-aca0-76a34b51215b.png`
- Source pixels: `2924 × 1434` and `2842 × 1500`, normalized to a maximum width of `1459px` for the combined comparison.
- Browser-rendered implementation:
  - `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-covers-home-final.png`
  - `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-covers-gallery-final.png`
  - `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-covers-library-final.png`
- Combined full-view comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-covers-comparison.png`
- Implementation viewport: `1459 × 851` CSS pixels, DPR `1`.
- State: 首页精选行展示最近三门完整课程；首页“我的真实课程”和 `/course` 展示持久化课程列表。

## Full-view comparison

- 首页精选卡和课程列表都已从通用渐变标题卡切换为课程第一节 HTML 的 `16:9` 等比缩小画布，外层导航箭头、课芽米白背景和现有信息层级保持不变。
- 首页精选行只出现 `5/5` 等完整生成课程；浏览器中的实际精选结果为“太阳系入门”“高一数学”“火星探险任务”，生成中、暂停、失败、取消和页数不完整记录未进入该区域。
- 列表中没有第一节完成结果的课程继续显示现有品牌占位封面，不会用第二节冒充封面，也不会出现空白或破损图片。

## Required fidelity surfaces

- Fonts and typography: 保留课芽既有站点字体、标题层级、状态标签和正文密度；封面文字来自课程自身 HTML，没有重复叠加卡片标题。
- Spacing and layout rhythm: 首页三张封面均为 `384 × 216`；首页列表封面为 `280 × 157.5`；`/course` 封面为约 `387 × 218`，全部保持 `16:9` 且覆盖可用卡片宽度。
- Colors and visual tokens: 页面壳层继续使用米白、课芽绿和原状态色；封面色彩由对应课程 HTML 决定，符合参考图“每门课程具有自身视觉主题”的意图。
- Image quality and asset fidelity: 画面直接渲染已生成的第一节 HTML 及其内部真实素材，没有截图占位、CSS 伪造插画或拉伸裁切；固定 `960 × 540` 虚拟画布保证缩小时不触发移动端重排。
- Copy and content: 首页与列表的固定文案、筛选项和状态信息未改变；封面内容与第一节学习内容一致。
- Interaction and accessibility: iframe 不可点击、不可聚焦、`aria-hidden`，只开放平台适配脚本且不开放同源；外层 Button/Link 是唯一导航目标。`390 × 844` 检查中根文档 `scrollWidth` 与 `clientWidth` 均为 `390px`。

## Focused-region comparison

组合图中的精选行和两组课程卡均按 `880px` 面板宽度展示，封面构图、裁切、箭头叠层、状态区和文本层级均可清晰判断，因此不需要额外放大裁切。

## Comparison history

1. 首轮浏览器截图发现三张精选封面中两张仍显示占位样式。根因是服务端预加载 iframe 可能在 React hydration 绑定 `onLoad` 前完成，导致组件永远保持透明。
2. 修复后封面可见性只依赖已测得的容器几何，不再依赖可能丢失的加载事件。
3. 相同 `1459 × 851` 视口复测中三张精选 iframe 均为 `opacity: 1`，尺寸均完整覆盖卡片内容区；首页列表和 `/course` 也渲染真实第一节封面，控制台 error/warn 为 `0`。

## Primary interactions tested

1. 首页精选数据排除暂停、生成中、失败、取消和不完整课程。
2. 首页三张精选封面加载并通过外层按钮保留课程导航。
3. 首页课程列表的四列封面、无第一节时的品牌占位及状态信息。
4. `/course` 三列课程卡的第一节封面、搜索和状态筛选壳层。
5. `390 × 844` 窄屏下无根级横向溢出。
6. 实际页面 iframe 保持 `sandbox="allow-scripts"`、无 `allow-same-origin`，并设置 inert、no-referrer 和 `scrolling="no"`。

final result: passed

---

# 课程播放器画布与缩略图二次校正 Design QA（2026-07-27）

## Evidence

- Expanded source: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-cdb4155e-f104-4269-9092-27297316b597.png`
- Collapsed source: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-5bbc3aa6-a90d-4688-b220-00ad259be575.png`
- Expanded implementation: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-round2-expanded.png`
- Collapsed implementation: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-round2-collapsed.png`
- Expanded comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-round2-expanded-comparison.png`
- Collapsed comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-round2-collapsed-comparison.png`
- Viewport: `1503 × 858` CSS pixels, DPR `1`.
- State: 讲解模式、字幕开启、目录折叠、当前第 `3 / 5` 页，并分别覆盖缩略图展开和收起状态。

## Geometry verification

- 主画布为 `1064 × 598`，iframe 为 `1060 × 594`；两侧各 `2px` 来自画布内边框，iframe 已填满可用内容区域。
- 展开状态下缩略图列表左右剩余空间均为 `496.5px`，短列表实现严格水平居中；列表无需滚动时 `clientWidth` 与 `scrollWidth` 均为 `1343px`。
- 收起状态下控制行底边为 `834px`，距 `858px` 视口底部恰好 `24px`。
- 展开、收起两种状态的根文档横向和纵向溢出均为 `0`。

## Fidelity review

- Typography: 保留课芽现有字体、字号和字重体系，控制按钮标签与参考图的视觉密度一致。
- Spacing: 缩略图从左对齐改为真正居中；收起后使用稳定的 `24px` 底部安全间距。
- Colors: 继续使用现有米白底、深棕控制按钮与课芽绿色当前页描边。
- Image quality: 缩略图仍为当前课程 HTML 的等比缩小预览，没有改用静态占位图。
- Copy and content: 页码、字幕、倍速及展开/收起提示保持现有中文文案；缩略图卡片只在视觉上展示编号。
- Interaction and accessibility: 缩略图展开/收起、当前页状态及控制按钮语义保持可用；浏览器控制台 error 数量为 `0`。

## Generated canvas contract

- 旧课程来自更新前的生成合同，未带流式画布标记，因此仍按兼容模式等比 contain；本次不会静默改写历史课程内容。
- 新生成课程会写入 `data-keya-canvas-mode="fluid"`，并要求 `html/body/main` 使用 `100%` 宽高、零边距、无根级固定尺寸和无滚动。
- Page QA 使用未经播放器适配的原始 HTML 测量主内容覆盖率；低于 `90%` 会报 `BROWSER_CANVAS_NOT_FILLED`，纵向或嵌套溢出也会触发修复/拆页，而不是让播放器继续缩小长页。

## Comparison history

1. 参考图中的短缩略图列表居中，而实现此前从左侧开始排列；收起状态的控制行也缺少明确底部安全距离。
2. 实现为首尾缩略图增加自动外边距，并为收起状态增加 `24px` 底部间距。
3. 在匹配视口下重新捕获展开与收起状态，几何测量、组合对比、交互和控制台检查均通过。

## Primary interactions tested

1. 展开缩略图并确认短列表水平居中。
2. 点击收起缩略图，确认缩略图区从布局移除且按钮状态同步。
3. 收起状态下确认控制区距视口底部 `24px`。
4. 确认画布、控制区和页面根节点均无滚动溢出。

final result: passed

---

# 课程播放器参考图复刻 Design QA（2026-07-27）

## Evidence

- Source visual truth: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-f73b1827-ae8b-44f3-a641-fdabefe84e67.png`
- Source app viewport: `1503 × 858`（原图去除浏览器栏后按 2× 像素密度归一化）。
- Intended state: `/course/[courseId]`；目录默认折叠；讲解模式；字幕开启；缩略图展开；当前第 1 / 5 页。
- Browser-rendered implementation: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-reference-aligned.png`
- Combined comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/course-player-comparison.png`

## Geometry verification

- 页面尺寸：`1503 × 858`，`body` 和根文档均无横向或纵向页面溢出。
- 主课程画布：`1064 × 598`，比例为 `16:9`，位置 `x=219.5 / y=87`。
- iframe 可视区域：完全填满课程画布；根文档 `overflow:hidden`，`scrollWidth/clientWidth` 与 `scrollHeight/clientHeight` 一致。
- 控制行：`y=719 / h=50`；缩略图条：`y=798 / h=60`，与参考图的垂直节奏一致。
- 折叠目录不占宽度、不渲染旧页面轨道；只保留左边缘 `24 × 40` 展开按钮。
- 每个缩略图卡片为 `62 × 38`，内部是对应课程 HTML 的 `960 × 540` 不可交互 iframe 缩放预览；仅保留左上角两位编号徽标。

## Visual and interaction findings

- 主画布、居中分页胶囊、右侧字幕/倍速/缩略图控制以及全宽缩略图条已与参考图建立同一层级和节奏。
- 真实 HTML 缩略图可水平导航，当前页使用绿色描边；标题仅作为无障碍名称，不在卡片中显示。
- 旧课程长页通过平台视口适配运行时等比 contain，消除文档及嵌套滚动条；新生成课程由固定画布合同和 QA 溢出检查提前拆页，避免依赖运行时缩小。
- 未发现播放器壳层的 P0/P1/P2 视觉、交互或可访问性问题。

## Primary interactions tested

1. 默认折叠目录不占据任何布局宽度；展开后显示完整课程地图，再次收起恢复边缘按钮。
2. 缩略图条展开/收起，收起后从 DOM 移除，开关文案和 `aria-expanded` 同步。
3. 点击真实 HTML 缩略图进入第 2 页，标题、当前页语义和计数同步更新。
4. 讲解/自学切换；自学模式关闭字幕与播放入口，返回讲解模式后恢复。
5. 全屏按钮在进入/退出状态间正确切换。
6. `390 × 844` 下页面宽度保持 `390px`，画布、控制区和缩略图区均为 `366px`，无横向溢出。
7. 主 iframe 与缩略图 iframe 均不开放 `allow-same-origin`；缩略图 `aria-hidden`、`tabIndex=-1`、`pointer-events:none`。

final result: passed

---

# 对话管理与课程任务隔离 Design QA（2026-07-27）

## Evidence

- Source visual truth: `/var/folders/5w/34yz2hh57tj01qycf35mvct00000gn/T/codex-clipboard-b4313156-2b2f-4570-8926-036d5e1d7ddd.png`
- Source pixels: `636 × 1118`, treated as 1×.
- Browser-rendered menu state: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/chat-conversation-actions-menu.png`
- Browser-rendered isolation state: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/chat-task-isolation-state.png`
- Focused source/implementation comparison: `/Users/eeo/.codex/visualizations/2026/07/27/019fa147-9d95-7ac1-9998-2a10fa0b2fc8/chat-conversation-actions-comparison.png`
- Implementation viewport: `1512 × 805`, 1×.
- Intended state: `/chat`；课程一和课程二同时为非终态；课程二被暂停并置顶，课程一继续保持生成中；课程二操作菜单展开。

## Fidelity review

- Typography: 对话标题、分组标题和菜单文字继续使用课芽现有字号与字重；生成中标题使用 sprout green，暂停状态使用克制的琥珀色。
- Spacing and hierarchy: 侧栏保持 `300px` 产品宽度，菜单从当前行右下方展开；菜单为紧凑三项结构，危险操作由分隔线与红色文案单独强调。
- Colors and tokens: 沿用米白画布、浅棕选中行、深棕正文与课芽绿色，不引入第二套视觉语言。
- Icons and assets: 置顶、重命名、删除、生成中及暂停均复用 Lucide 图标；没有新增手绘 SVG。
- Copy and content: 菜单严格使用“置顶对话 / 取消置顶、重命名、删除对话”；运行行显示“生成中”，暂停行显示“已暂停”。
- Interaction and accessibility: 更多按钮具有带标题的无障碍名称；菜单使用 `menu/menuitem` 语义；重命名输入支持 Enter、Escape 和失焦提交，并防止 Enter 后的 blur 产生重复请求。

## Isolation verification

1. 创建两条临时持久化课程任务，初始状态均为 `running`，分别绑定独立 `conversationId / taskId / traceId`。
2. 在课程二点击“暂停生成”后，DOM 同时显示“课程二 已暂停”和“课程一 生成中”。
3. 持久化记录确认课程一仍为 `running`；课程二删除前仅自身转为 `cancelled`。
4. 在课程二输入“课程二专属草稿”，切到课程一时输入框为空；切回课程二后草稿完整恢复。
5. 课程二置顶后从历史组移入自动展开的置顶组；重命名成功；确认删除后只取消并删除课程二，界面安全切到仍在生成的课程一。
6. 任务流使用 `taskId:traceId` 作为桥接键；终态、进度、错误与遥测回调均验证当前 registry 记录，旧流不能覆盖恢复后的新 trace。
7. 浏览器控制台 error/warn 数量为 `0`；临时 QA 数据已清除，开发服务器已关闭。
8. 外部暂停会只释放对应对话的 busy 状态；终态或流错误会清理该对话遥测；任务尚未返回 `taskId` 时阻止删除，避免留下无法取消的孤儿任务。

## Comparison history

1. 参考图要求当前行的更多菜单直接包含置顶、重命名和删除；初始实现只有无行为的省略号按钮。
2. 首轮实现补齐菜单、生成中/暂停行样式和对话级任务 registry，并通过真实浏览器复现“暂停课程二、课程一继续生成”。
3. 浏览器日志发现 Enter 提交重命名后 blur 会额外发起一次 PATCH；最终增加单次提交保护，保留 Enter、Escape 与失焦三种交互。
4. 聚焦视觉对照、任务隔离、草稿切换、菜单操作、控制台与持久化状态均完成复核。

final result: passed
