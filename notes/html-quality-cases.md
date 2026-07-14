# HTML Engineer 三风格质量用例

## 固定输入

- PageContentDSL：`page-02-knowledge`，主题“恒星与行星”。
- FunctionalTemplate：`knowledge-card-grid`。
- 内容块：恒星、行星两个概念块。
- 互动：`reveal`，使用无脚本的原生静态降级。
- 视口：375×812、768×1024、1440×900。

## 风格矩阵

| StyleTemplate | 必须保持 | 应明显变化 | 自动化检查 |
| --- | --- | --- | --- |
| `sci-fi` | 标题、两个概念、互动语义和稳定 ID | 深色太空背景、轨道/星点语言、明亮强调色 | Prompt 注入真实 sci-fi Token；合同与安全用例通过 |
| `kids-playful` | 同上 | 童趣色彩、柔和形状、轻快卡片关系 | Prompt 注入真实 kids-playful Token；合同与安全用例通过 |
| `minimal` | 同上 | 克制留白、低装饰、清晰排版层级 | Prompt 注入真实 minimal Token；合同与安全用例通过 |

## 判定规则

1. 生成结果必须通过 doctype、html/head/body、viewport 和内联 style 合同。
2. 必须保留 `data-page-id`、全部 `data-block-id`、`data-interaction-type` 和已有素材槽位标记。
3. 禁止脚本、事件属性、危险 URL、外部 CSS、外部 iframe 和主动嵌入元素。
4. 375px 下不得横向滚动；1440px 下内容不能被无限拉宽。
5. 三种输出允许 DOM 和布局不同，但不能新增、删除或改写教学事实。
6. 视觉差异必须来自 StyleTemplate 和 VisualBrief，不能硬编码课程专属的第二套视觉系统。
