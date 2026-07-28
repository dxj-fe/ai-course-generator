import type {
  AssetGenerationResult,
  PageContentDSL,
  QualityDimensionName,
  QualityIssue,
  QualitySeverity,
} from "@/shared/course-schema";
import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

type BasicLayoutHeuristicsInput = {
  content: PageContentDSL;
  html: string;
  assets?: AssetGenerationResult[];
};

/**
 * 无模型、可重复的 HTML 风险检查。这里只报告静态证据；真实遮挡仍需浏览器几何测量。
 */
export function basicLayoutHeuristics({
  content,
  html,
  assets = [],
}: BasicLayoutHeuristicsInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (
    code: string,
    dimension: QualityDimensionName,
    severity: QualitySeverity,
    message: string,
    repairHint: string,
    location: Partial<QualityIssue["location"]> = {},
  ) => {
    issues.push({
      code,
      dimension,
      severity,
      source: "heuristic",
      message,
      repairHint,
      location: {
        pageId: content.pageId,
        description: location.description ?? "当前页面 HTML 文档",
        ...location,
      },
    });
  };

  for (const issue of validateGeneratedHtmlContract(html).issues) {
    add(
      `HTML_CONTRACT_${issue.code.toUpperCase()}`,
      "htmlRuntime",
      "error",
      issue.message,
      "重新生成完整的独立 HTML 文档，并补齐缺失的文档合同。",
      { selector: "html", description: "HTML 文档结构" },
    );
  }

  for (const issue of sanitizeHtmlLite(html).issues) {
    add(
      `HTML_SAFETY_${issue.code.toUpperCase()}`,
      "htmlRuntime",
      "error",
      issue.message,
      "删除危险能力并使用内联、静态且可被空 sandbox 隔离的实现。",
      { selector: "html", description: "HTML 安全边界" },
    );
  }

  if (!/<main\b/i.test(html)) {
    add(
      "HTML_MAIN_MISSING",
      "htmlRuntime",
      "error",
      "页面缺少 main 主内容区域。",
      "使用唯一的 main 元素包裹页面主体。",
      { selector: "body", description: "页面主体" },
    );
  }

  if (!/<html\b[^>]*\blang\s*=/i.test(html)) {
    add(
      "HTML_LANG_MISSING",
      "htmlRuntime",
      "warning",
      "HTML 根元素没有声明页面语言。",
      "在 html 元素上设置与课程语言一致的 lang 属性。",
      { selector: "html", description: "HTML 根元素" },
    );
  }

  const visibleText = normalizeVisibleText(html);
  if (visibleText.length > 3_000) {
    add(
      "TEXT_OVERLOAD",
      "layoutQuality",
      "warning",
      `页面可见文本约 ${visibleText.length} 字符，存在信息过载风险。`,
      "拆分页面或压缩次要说明，保持一个页面只承担一个核心学习目标。",
      { selector: "main", description: "页面全部可见正文" },
    );
  }

  const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi) ?? [];
  paragraphs.forEach((paragraph, index) => {
    const text = normalizeVisibleText(paragraph);
    if (text.length > 320) {
      add(
        "PARAGRAPH_TOO_LONG",
        "layoutQuality",
        "warning",
        `第 ${index + 1} 个段落包含 ${text.length} 个字符，阅读负担较高。`,
        "将长段落拆成更短的解释、要点或示例。",
        {
          selector: `p:nth-of-type(${index + 1})`,
          description: `第 ${index + 1} 个正文段落`,
        },
      );
    }
  });

  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  images.forEach((image, index) => {
    if (!/\bsrc\s*=\s*(["'])[^"']+\1/i.test(image)) {
      add(
        "ASSET_EMPTY_SRC",
        "assetUsability",
        "error",
        `第 ${index + 1} 张图片缺少有效 src。`,
        "提供本地或内联的有效图片地址；没有素材时移除空图片元素。",
        { selector: `img:nth-of-type(${index + 1})`, description: `第 ${index + 1} 张图片` },
      );
    }
    if (!/\balt\s*=\s*(["'])[^"']*\1/i.test(image)) {
      add(
        "ASSET_ALT_MISSING",
        "assetUsability",
        "warning",
        `第 ${index + 1} 张图片缺少 alt 属性。`,
        "信息图片提供描述性 alt；纯装饰图片显式设置空 alt。",
        { selector: `img:nth-of-type(${index + 1})`, description: `第 ${index + 1} 张图片` },
      );
    }
  });

  const assetResults = new Map(
    assets.map((result) => [result.request.assetSlotId, result]),
  );
  for (const slot of content.assetSlots) {
    const result = assetResults.get(slot.id);
    if (!result) {
      add(
        "ASSET_RESULT_MISSING",
        "assetUsability",
        slot.required ? "error" : "warning",
        `素材槽位 ${slot.id} 缺少生图结果或降级记录。`,
        `先为 ${slot.id} 生成素材，或记录明确的 fallback 后再生成 HTML。`,
        {
          selector: `[data-asset-slot-id="${slot.id}"]`,
          description: `素材槽位 ${slot.id}`,
        },
      );
      if (slot.required && !hasUsableAssetSlot(html, slot.id)) {
        add(
          "ASSET_REQUIRED_SLOT_EMPTY",
          "assetUsability",
          "error",
          `必需素材槽位 ${slot.id} 没有可识别的图片或矢量内容。`,
          `为 ${slot.id} 提供与“${slot.purpose}”一致的可用素材。`,
          {
            selector: `[data-asset-slot-id="${slot.id}"]`,
            description: `必需素材槽位 ${slot.id}`,
          },
        );
      }
      continue;
    }

    if (result.status === "fallback") {
      if (
        result.fallback &&
        !hasAttributesOnSameTag(html, {
          "data-asset-slot-id": slot.id,
          "data-asset-fallback": result.fallback.kind,
        })
      ) {
        add(
          "ASSET_FALLBACK_NOT_RENDERED",
          "assetUsability",
          "error",
          `素材槽位 ${slot.id} 没有按记录实现 ${result.fallback.kind} 降级。`,
          "在素材根节点实现降级视觉，并写入匹配的 data-asset-fallback 标记。",
          {
            selector: `[data-asset-slot-id="${slot.id}"]`,
            description: `素材槽位 ${slot.id}`,
          },
        );
      }
      add(
        "ASSET_FALLBACK_USED",
        "assetUsability",
        "warning",
        `素材槽位 ${slot.id} 使用 ${result.fallback?.kind ?? "fallback"} 降级。`,
        "确认降级视觉不遮挡正文；需要更高保真度时可单独重试该素材。",
        {
          selector: `[data-asset-slot-id="${slot.id}"]`,
          description: `素材槽位 ${slot.id}`,
        },
      );
      continue;
    }

    if (result.asset?.uri && !html.includes(result.asset.uri)) {
      add(
        "ASSET_URI_NOT_REFERENCED",
        "assetUsability",
        "error",
        `素材槽位 ${slot.id} 没有引用已生成图片。`,
        `在 ${slot.id} 节点中使用已批准的内部素材 URI。`,
        {
          selector: `[data-asset-slot-id="${slot.id}"]`,
          description: `素材槽位 ${slot.id}`,
        },
      );
    } else if (
      slot.required &&
      !hasUsableAssetSlot(html, slot.id, result.asset?.uri)
    ) {
      add(
        "ASSET_REQUIRED_SLOT_EMPTY",
        "assetUsability",
        "error",
        `必需素材槽位 ${slot.id} 没有可识别的图片或矢量内容。`,
        `为 ${slot.id} 提供与“${slot.purpose}”一致的可用素材。`,
        {
          selector: `[data-asset-slot-id="${slot.id}"]`,
          description: `必需素材槽位 ${slot.id}`,
        },
      );
    }

    if (
      result.warnings?.includes("TRANSPARENCY_UNAVAILABLE") &&
      !hasSafelyContainedOpaqueAssetFallback(
        html,
        slot.id,
        result.asset?.uri,
      )
    ) {
      add(
        "ASSET_TRANSPARENCY_UNAVAILABLE",
        "assetUsability",
        "warning",
        `素材槽位 ${slot.id} 已生成图片，但供应商没有返回透明通道。`,
        "把图片放在独立容器中，避免将不透明背景直接叠加在正文或复杂背景上。",
        {
          selector: `[data-asset-slot-id="${slot.id}"]`,
          description: `素材槽位 ${slot.id}`,
        },
      );
    }
  }

  if (/(?:^|[;{])\s*(?:min-)?width\s*:\s*(?:[89]\d{2}|[1-9]\d{3,})px/i.test(html)) {
    add(
      "LAYOUT_FIXED_WIDTH_RISK",
      "layoutQuality",
      "warning",
      "样式中存在较大的固定宽度，窄屏可能产生横向溢出。",
      "改用 max-width、百分比或响应式网格，并在窄屏验证 scrollWidth。",
      { selector: "style", viewport: "375px", description: "页面内联样式" },
    );
  }

  if (/overflow\s*:\s*hidden/i.test(html)) {
    add(
      "LAYOUT_CLIPPING_RISK",
      "layoutQuality",
      "warning",
      "页面使用 overflow:hidden，动态字号或窄屏下可能裁切内容。",
      "限定隐藏范围，或在 375px、768px、1440px 视口检查实际裁切。",
      { selector: "style", description: "包含 overflow:hidden 的样式规则" },
    );
  }

  if (hasLowContrastPair(html)) {
    add(
      "CONTRAST_RISK",
      "layoutQuality",
      "warning",
      "样式中存在可计算的低对比度文字与背景色组合。",
      "调整文字或背景 Token，使常规正文达到至少 4.5:1 的对比度。",
      { selector: "style", description: "低对比度颜色声明" },
    );
  }

  return dedupeIssues(issues);
}

/**
 * 透明通道缺失是 Provider 能力提示，不等同于页面缺陷。只有素材已作为唯一
 * img 放进独立的普通流容器时才视为完成 HTML 降级；直接把不透明图用于槽位
 * 根节点或 CSS 背景仍保留 QA issue。
 */
export function hasSafelyContainedOpaqueAssetFallback(
  html: string,
  slotId: string,
  approvedUri?: string,
) {
  if (!approvedUri) return false;
  const markers = [...html.matchAll(/<[a-z][^>]*>/gi)].filter(
    (match) =>
      readAttribute(match[0], "data-asset-slot-id") === slotId,
  );
  if (markers.length !== 1 || markers[0]?.index === undefined) return false;

  const openingTag = markers[0][0];
  const tagName = /^<\s*([a-z][a-z0-9-]*)/i.exec(openingTag)?.[1];
  if (
    !tagName ||
    !["aside", "div", "figure", "picture", "section"].includes(
      tagName.toLowerCase(),
    )
  ) {
    return false;
  }
  const inlineStyle = readAttribute(openingTag, "style") ?? "";
  if (/\bposition\s*:\s*(?:absolute|fixed)\b/i.test(inlineStyle)) {
    return false;
  }

  const element = readElementHtml(
    html,
    markers[0].index,
    openingTag,
    tagName,
  );
  if (!element) return false;
  const approvedImages = (element.match(/<img\b[^>]*>/gi) ?? []).filter(
    (tag) => readAttribute(tag, "src") === approvedUri,
  );
  if (approvedImages.length === 1) return true;

  const usesApprovedBackground =
    backgroundDeclarationUsesUri(inlineStyle, approvedUri) ||
    hasUniqueStylesheetBackground(
      html,
      openingTag,
      slotId,
      approvedUri,
    );
  if (!usesApprovedBackground) return false;
  const innerMarkup = element
    .slice(openingTag.length)
    .replace(new RegExp(`</\\s*${escapeRegex(tagName)}\\s*>\\s*$`, "i"), "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return innerMarkup.length === 0;
}

function hasAttributesOnSameTag(
  html: string,
  attributes: Record<string, string>,
) {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).some((tag) =>
    Object.entries(attributes).every(([attribute, value]) => {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `\\b${attribute}\\s*=\\s*(["'])${escapedValue}\\1`,
        "i",
      ).test(tag);
    }),
  );
}

function normalizeVisibleText(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUsableAssetSlot(
  html: string,
  slotId: string,
  approvedUri?: string,
) {
  const escaped = slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const paired = new RegExp(
    `<([a-z][a-z0-9-]*)\\b[^>]*data-asset-slot-id\\s*=\\s*(["'])${escaped}\\2[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "i",
  ).exec(html)?.[0];
  const selfClosing = new RegExp(
    `<(?:img|svg|picture|canvas)\\b[^>]*data-asset-slot-id\\s*=\\s*(["'])${escaped}\\1[^>]*>`,
    "i",
  ).test(html);
  const openingTag = paired?.match(/^<[^>]+>/)?.[0];
  const inlineStyle = openingTag
    ? /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(openingTag)?.[2]
    : undefined;
  const inlineBackground = Boolean(
    inlineStyle &&
      /\bbackground(?:-image)?\s*:[^;]*\burl\s*\([^)]*\)/i.test(inlineStyle),
  );
  const stylesheetBackground = Boolean(
    openingTag &&
      approvedUri &&
      hasUniqueStylesheetBackground(
        html,
        openingTag,
        slotId,
        approvedUri,
      ),
  );

  return (
    selfClosing ||
    inlineBackground ||
    stylesheetBackground ||
    Boolean(paired && /<(?:img|svg|picture|canvas)\b/i.test(paired))
  );
}

function hasUniqueStylesheetBackground(
  html: string,
  openingTag: string,
  slotId: string,
  approvedUri: string,
) {
  const selectors: RegExp[] = [];
  const classNames = readAttribute(openingTag, "class")
    ?.split(/\s+/)
    .filter(Boolean) ?? [];
  for (const className of classNames) {
    if (countClassOwners(html, className) !== 1) continue;
    const escaped = escapeRegex(className);
    selectors.push(
      new RegExp(
        `^\\.${escaped}(?::(?:before|after)|::(?:before|after))?$`,
      ),
    );
  }

  const id = readAttribute(openingTag, "id");
  if (id && countAttributeOwners(html, "id", id) === 1) {
    const escaped = escapeRegex(id);
    selectors.push(
      new RegExp(
        `^#${escaped}(?::(?:before|after)|::(?:before|after))?$`,
      ),
    );
  }

  if (countAttributeOwners(html, "data-asset-slot-id", slotId) === 1) {
    const escaped = escapeRegex(slotId);
    selectors.push(
      new RegExp(
        `^\\[\\s*data-asset-slot-id\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped})\\s*\\](?::(?:before|after)|::(?:before|after))?$`,
      ),
    );
  }

  return selectors.some((selector) =>
    stylesheetBindsSelectorToUri(html, selector, approvedUri),
  );
}

function stylesheetBindsSelectorToUri(
  html: string,
  selectorPattern: RegExp,
  approvedUri: string,
) {
  for (const styleMatch of html.matchAll(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
  )) {
    for (const rule of (styleMatch[1] ?? "").matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      const selectors = (rule[1] ?? "")
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean);
      if (
        selectors.length === 1 &&
        selectorPattern.test(selectors[0]!) &&
        backgroundDeclarationUsesUri(rule[2] ?? "", approvedUri)
      ) {
        return true;
      }
    }
  }
  return false;
}

function backgroundDeclarationUsesUri(
  declarations: string,
  approvedUri: string,
) {
  const escapedUri = escapeRegex(approvedUri);
  return new RegExp(
    `(?:^|;)\\s*(?:background|background-image)\\s*:[^;]*url\\(\\s*(?:["'])?${escapedUri}(?:["'])?\\s*\\)`,
    "i",
  ).test(declarations.replace(/\/\*[\s\S]*?\*\//g, " "));
}

function countClassOwners(html: string, className: string) {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) =>
    (readAttribute(tag, "class") ?? "").split(/\s+/).includes(className),
  ).length;
}

function countAttributeOwners(
  html: string,
  attribute: string,
  expectedValue: string,
) {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).filter(
    (tag) => readAttribute(tag, attribute) === expectedValue,
  ).length;
}

function readAttribute(tag: string, attribute: string) {
  const escapedAttribute = escapeRegex(attribute);
  return new RegExp(
    `\\b${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`,
    "i",
  ).exec(tag)?.[2];
}

function readElementHtml(
  html: string,
  index: number,
  openingTag: string,
  tagName: string,
) {
  const escapedTagName = escapeRegex(tagName);
  const pattern = new RegExp(`<\\/?\\s*${escapedTagName}\\b[^>]*>`, "gi");
  pattern.lastIndex = index + openingTag.length;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    if (/^<\s*\//.test(match[0])) {
      depth -= 1;
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }
    if (depth === 0) {
      return html.slice(index, match.index + match[0].length);
    }
  }
  return undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasLowContrastPair(html: string) {
  const rules = html.match(/[^{}]+\{[^{}]+\}/g) ?? [];

  return rules.some((rule) => {
    const color = /(?:^|[;{])\s*color\s*:\s*(#[0-9a-f]{6})/i.exec(rule)?.[1];
    const background = /(?:^|[;{])\s*background(?:-color)?\s*:\s*(#[0-9a-f]{6})/i.exec(rule)?.[1];
    return color && background
      ? contrastRatio(color, background) < 4.5
      : false;
  });
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return channels.reduce(
    (sum, channel, index) =>
      sum +
      (channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index],
    0,
  );
}

function dedupeIssues(issues: QualityIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.location.selector ?? ""}:${issue.location.blockId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
