import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  listStyleTemplates,
  styleTemplateToCssText,
  styleTemplateToCssVariables,
  type CourseCssVariables,
  type StyleTemplate,
} from "@/shared/templates/style";

type PreviewStyle = CSSProperties & CourseCssVariables;

/** 展示六套样式模板，并使用同一份预览结构验证 Token 可组合性。 */
export function StyleTemplateGallery() {
  const templates = listStyleTemplates();

  return (
    <section className="flex flex-col gap-6" aria-labelledby="style-templates">
      <header className="flex flex-wrap items-end justify-between gap-4 border-t border-[#d8dee8] pt-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#7c3aed]">
            Day 09 · Style Template Registry
          </p>
          <h2
            className="mt-2 text-2xl font-semibold text-[#101827]"
            id="style-templates"
          >
            样式模板预览
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#64748b]">
            六张卡片使用同一份内容结构，只切换共享 Registry 生成的 CSS Variables。视觉差异来自 Design Tokens，而不是为每套风格手写页面。
          </p>
        </div>
        <span className="rounded-full bg-[#ede9fe] px-3 py-1.5 text-xs font-semibold text-[#6d28d9]">
          {templates.length} 套风格 · 48 种组合已校验
        </span>
      </header>

      <div
        className="grid items-start gap-6 lg:grid-cols-2"
        aria-label="样式模板列表"
      >
        {templates.map((template) => (
          <StyleTemplateCard key={template.id} template={template} />
        ))}
      </div>
    </section>
  );
}

/** 使用模板生成的 CSS Variables 渲染单个风格预览和 Token 摘要。 */
function StyleTemplateCard({ template }: { template: StyleTemplate }) {
  const variables = styleTemplateToCssVariables(template);
  const previewStyle: PreviewStyle = {
    ...variables,
    backgroundColor: "var(--course-color-background)",
    backgroundImage: "var(--course-decoration-background)",
    color: "var(--course-color-text)",
    fontFamily: "var(--course-font-body)",
  };
  const cssText = styleTemplateToCssText(template, `.${template.id}-theme`);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#d8dee8] bg-white shadow-sm">
      <div className="p-4 sm:p-5" style={previewStyle}>
        <div
          className="rounded-[var(--course-radius-card)] border-[length:var(--course-border-width-card)] border-[var(--course-color-border)] bg-[var(--course-color-surface)] p-5 shadow-[var(--course-shadow-card)]"
          style={{ color: "var(--course-color-text)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--course-color-primary)" }}
              >
                Learning Mission
              </p>
              <h3
                className="mt-2 text-2xl"
                style={{
                  fontFamily: "var(--course-font-heading)",
                  fontWeight: "var(--course-font-weight-heading)",
                }}
              >
                探索太阳系
              </h3>
            </div>
            <span
              className="rounded-[var(--course-radius-control)] border border-[var(--course-color-border)] px-3 py-1 text-xs"
              style={{ color: "var(--course-color-accent)" }}
            >
              3 个知识点
            </span>
          </div>
          <p
            className="mt-3 text-sm"
            style={{
              color: "var(--course-color-muted)",
              lineHeight: "var(--course-line-height-body)",
            }}
          >
            认识行星、比较特征，并通过挑战检查学习结果。
          </p>
          <div className="mt-5 grid grid-cols-3 gap-[var(--course-spacing-card)]">
            {[
              ["01", "观察"],
              ["02", "比较"],
              ["03", "挑战"],
            ].map(([step, label]) => (
              <div
                className="rounded-[var(--course-radius-control)] border border-[var(--course-color-border)] bg-[var(--course-color-surface-alt)] p-3"
                key={step}
              >
                <span
                  className="text-[10px] font-bold"
                  style={{ color: "var(--course-color-primary)" }}
                >
                  {step}
                </span>
                <p className="mt-1 text-xs font-semibold">{label}</p>
              </div>
            ))}
          </div>
          <Button
            className="mt-5 h-auto rounded-[var(--course-radius-control)] border-0 px-4 py-2 text-sm font-semibold"
            style={{
              backgroundColor: "var(--course-color-primary)",
              color: "var(--course-color-background)",
            }}
            type="button"
          >
            开始任务
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-[#64748b]">{template.id}</p>
            <h3 className="mt-1 text-xl font-semibold text-[#101827]">
              {template.name}
            </h3>
          </div>
          <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#6d28d9]">
            {template.layoutDensity}
          </span>
        </div>
        <p className="text-sm leading-6 text-[#475569]">{template.goal}</p>

        <section aria-label={`${template.name} 色彩 Token`}>
          <h4 className="text-sm font-semibold text-[#344054]">语义色彩</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["背景", template.colorTokens.background],
              ["表面", template.colorTokens.surface],
              ["主色", template.colorTokens.primary],
              ["强调", template.colorTokens.accent],
              ["文字", template.colorTokens.text],
            ].map(([label, color]) => (
              <div
                className="flex items-center gap-2 rounded-full border border-[#d8dee8] bg-[#f8fafc] py-1 pl-1 pr-3 text-xs text-[#64748b]"
                key={label}
              >
                <span
                  className="size-5 rounded-full border border-black/10"
                  style={{ backgroundColor: color }}
                />
                {label}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 text-xs text-[#64748b] sm:grid-cols-2">
          <section>
            <h4 className="font-semibold text-[#344054]">排版与表面</h4>
            <p className="mt-2 leading-5">
              标题：{template.typography.headingFont}
              <br />
              正文：{template.typography.bodyFont}
              <br />
              卡片圆角：{template.surface.cardRadius}
            </p>
          </section>
          <section>
            <h4 className="font-semibold text-[#344054]">素材指导</h4>
            <p className="mt-2 leading-5">{template.assetGuidance.visualStyle}</p>
          </section>
        </div>

        <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
            查看 CSS Variables
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
            {cssText}
          </pre>
        </details>
      </div>
    </article>
  );
}
