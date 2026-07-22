"use client";

import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HtmlPreviewFrame } from "@/features/seaca/html-preview-frame";
import { AssetGallery } from "@/features/seaca/asset-gallery";
import { CoursePreviewGrid } from "@/features/seaca/course-preview-grid";
import { PageProgressPanel } from "@/features/seaca/page-progress-panel";
import { PageQualityPanel } from "@/features/seaca/page-quality-panel";
import { RepairLogPanel } from "@/features/seaca/repair-log-panel";
import { ReferencePanel } from "@/features/seaca/reference-panel";
import type { PageContentDSL, PagePlan } from "@/shared/course-schema";
import type {
  CourseRunStageStatus,
  SeacaCourseRun,
} from "@/types/seaca";

type CourseWorkspacePanelProps = {
  run?: SeacaCourseRun;
  busy?: boolean;
  onGenerateDesign(): void;
  onGenerateAssets(pageId: string): void;
  onGenerateHtml(pageId: string): void;
  onEvaluatePage(pageId: string): void;
  onGeneratePage(pageId: string): void;
  onOpenHtmlPreview(pageId: string): void;
  onResumeCourse(): void;
};

const statusCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待生成",
  running: "生成中",
  completed: "已生成",
  failed: "生成失败",
};

/** 用 Seaca 的暖色工作区承载已存在的课程规划、专业设计和 Page DSL 结果。 */
export function CourseWorkspacePanel({
  run,
  busy = false,
  onGenerateDesign,
  onGenerateAssets,
  onGenerateHtml,
  onEvaluatePage,
  onGeneratePage,
  onOpenHtmlPreview,
  onResumeCourse,
}: CourseWorkspacePanelProps) {
  const plannerResult = run?.planner.data;
  const outline = plannerResult?.state.outline;
  const intent = plannerResult?.intent;
  const designResult = run?.design.data;
  const briefs = designResult?.state.briefs;
  const designError = run?.design.error ?? designResult?.state.error?.message;
  const canGenerateDesign = Boolean(outline && intent);
  const generationError =
    run?.generation?.errors.at(-1)?.message ?? run?.planner.error;
  const canResumeCourse =
    run?.generation?.status === "failed" ||
    run?.generation?.status === "cancelled" ||
    Boolean(!run?.generation && run?.courseId && run?.planner.status === "failed");
  const previewPages =
    outline?.pages.map((page) => {
      const htmlStage = run?.pageHtml[page.id];
      return {
        id: page.id,
        order: page.order,
        title: page.title,
        status: htmlStage?.status ?? ("idle" as const),
        htmlOutput: htmlStage?.data?.state.htmlOutput?.html,
        error: htmlStage?.error ?? htmlStage?.data?.state.error?.message,
      };
    }) ?? [];

  return (
    <section
      aria-labelledby="course-workspace-title"
      className="min-h-full rounded-[22px] border border-[#e9dfd3] bg-[#fffdf8] shadow-[0_12px_40px_-32px_rgba(56,44,25,0.45)]"
    >
      <header className="border-b border-[#eee5da] py-5 pr-12 pl-4 sm:pl-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-[#77a863]">
          课程工作区
        </p>
        <h2
          className="mt-1 text-xl font-semibold text-[#382c19]"
          id="course-workspace-title"
        >
          {intent?.topic ?? "等待生成课程规划"}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#817568]">
          {outline?.overview ??
            "课程结构、专业设计与逐页内容会按生成顺序整理在这里。"}
        </p>
        {intent ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#6f6355]">
            <WarmTag>{intent.audienceAgeRange.label}</WarmTag>
            <WarmTag>{intent.courseLength} 页</WarmTag>
            <WarmTag>{intent.visualStyle}</WarmTag>
            <WarmTag>{intent.language}</WarmTag>
          </div>
        ) : null}
        {canResumeCourse ? (
          <Alert
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border-0 bg-[#fff0eb] px-3 py-3 text-sm text-[#984735]"
            variant="destructive"
          >
            <span className="min-w-0 leading-5">
              {generationError ?? "整课生成已停止，已完成页面仍然保留。"}
            </span>
            <Button
              className="h-8 shrink-0 rounded-full border border-[#dcaa9e] bg-[#fff8f5] px-3 text-xs font-semibold text-[#984735] hover:bg-white"
              disabled={busy}
              onClick={onResumeCourse}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy ? "正在恢复…" : "从断点继续"}
            </Button>
          </Alert>
        ) : null}
      </header>

      <div className="grid gap-7 px-4 py-5 sm:px-6 sm:py-6">
        <PlannerOutput run={run} />

        {run?.generation?.referencePacks?.length ? (
          <ReferencePanel
            packs={run.generation.referencePacks}
            pages={outline?.pages ?? []}
          />
        ) : null}

        <section aria-labelledby="professional-design-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3
                className="text-base font-semibold text-[#493b29]"
                id="professional-design-title"
              >
                专业设计
              </h3>
              <p className="mt-1 text-xs leading-5 text-[#988e80]">
                整课任务会自动生成教学、故事与视觉方案，也可在此单独重试。
              </p>
            </div>
            <ActionButton
              disabled={
                busy || !canGenerateDesign || run?.design.status === "running"
              }
              onClick={onGenerateDesign}
            >
              {run?.design.status === "running"
                ? "正在生成设计…"
                : briefs
                  ? "重新生成设计"
                  : "生成专业设计"}
            </ActionButton>
          </div>

          {designError ? (
            <ErrorNotice>{designError}</ErrorNotice>
          ) : briefs ? (
            <div className="mt-4 grid gap-3">
              <BriefCard
                eyebrow="教学设计"
                title="学习节奏"
                description={briefs.pedagogy.audienceSummary}
                detail={`每 ${briefs.pedagogy.interactionCadence.recommendedIntervalPages} 页安排一次互动`}
              />
              <BriefCard
                eyebrow="故事设计"
                title={briefs.story.learnerRole}
                description={briefs.story.premise}
                detail={briefs.story.mission}
              />
              <BriefCard
                eyebrow="视觉设计"
                title={briefs.visual.styleTemplateId}
                description={briefs.visual.visualConcept}
                detail={briefs.visual.motionGuidance.strategy}
              />
            </div>
          ) : (
            <PendingNotice
              status={run?.design.status ?? "idle"}
              idleCopy={
                canGenerateDesign
                  ? "课程规划已就绪，可以继续生成专业设计。"
                  : "请先完成课程规划。"
              }
            />
          )}
        </section>

        {outline && run ? <PageProgressPanel run={run} /> : null}

        {outline ? <CoursePreviewGrid pages={previewPages} /> : null}

        <section aria-labelledby="page-content-title">
          <div>
            <h3
              className="text-base font-semibold text-[#493b29]"
              id="page-content-title"
            >
              课程页面
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#988e80]">
              整课按顺序生成；单页失败时可从断点继续，也可只重试当前阶段。
            </p>
          </div>

          {run && outline?.pages.length ? (
            <ol className="mt-4 grid gap-3">
              {outline.pages.map((page) => (
                <PageWorkspaceCard
                  canGenerate={
                    !busy && Boolean(designResult?.state.pageWorkerBriefs)
                  }
                  key={page.id}
                  onGenerateHtml={() => onGenerateHtml(page.id)}
                  onGenerateAssets={() => onGenerateAssets(page.id)}
                  onEvaluatePage={() => onEvaluatePage(page.id)}
                  onGenerate={() => onGeneratePage(page.id)}
                  onOpenHtmlPreview={() => onOpenHtmlPreview(page.id)}
                  page={page}
                  run={run}
                />
              ))}
            </ol>
          ) : (
            <PendingNotice
              status={run?.planner.status ?? "idle"}
              idleCopy="课程结构生成后，页面列表会显示在这里。"
            />
          )}
        </section>
      </div>
    </section>
  );
}

function PlannerOutput({ run }: { run?: SeacaCourseRun }) {
  const result = run?.planner.data;
  const outline = result?.state.outline;
  const error = run?.planner.error ?? result?.state.error?.message;

  return (
    <section aria-labelledby="planner-output-title">
      <div className="flex flex-wrap items-center gap-2">
        <h3
          className="text-base font-semibold text-[#493b29]"
          id="planner-output-title"
        >
          课程规划
        </h3>
        <StatusBadge status={run?.planner.status ?? "idle"} />
      </div>

      {error ? (
        <ErrorNotice>{error}</ErrorNotice>
      ) : outline ? (
        <div className="mt-4 grid gap-4 rounded-2xl bg-[#f8f3ec] p-4">
          <div>
            <h4 className="text-sm font-semibold text-[#594a37]">学习目标</h4>
            <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#786d5f]">
              {outline.learningObjectives.map((objective) => (
                <li className="flex gap-2" key={objective}>
                  <span aria-hidden="true" className="text-[#77b95e]">
                    ✓
                  </span>
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </div>
          {result?.intent ? (
            <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-[#fffdf8] p-3 text-xs">
              <MetaField label="主题" value={result.intent.topic} />
              <MetaField
                label="难度"
                value={result.intent.difficulty}
              />
              <MetaField
                label="页数"
                value={`${result.intent.courseLength} 页`}
              />
              <MetaField
                label="视觉风格"
                value={result.intent.visualStyle}
              />
            </dl>
          ) : null}
        </div>
      ) : (
        <PendingNotice
          status={run?.planner.status ?? "idle"}
          idleCopy="发送课程需求后，Agent 会先生成课程结构。"
        />
      )}
    </section>
  );
}

function PageWorkspaceCard({
  page,
  run,
  canGenerate,
  onGenerate,
  onGenerateHtml,
  onGenerateAssets,
  onEvaluatePage,
  onOpenHtmlPreview,
}: {
  page: PagePlan;
  run: SeacaCourseRun;
  canGenerate: boolean;
  onGenerate(): void;
  onGenerateHtml(): void;
  onGenerateAssets(): void;
  onEvaluatePage(): void;
  onOpenHtmlPreview(): void;
}) {
  const write = run.pageWrites[page.id];
  const content = write?.data?.state.content;
  const error = write?.error ?? write?.data?.state.error?.message;
  const status = write?.status ?? "idle";
  const repairHistory =
    run.generation?.pages.find(({ pageId }) => pageId === page.id)
      ?.repairHistory ?? [];

  return (
    <li>
      <article className="rounded-2xl border border-[#e9dfd3] bg-[#fffefa] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eff7e9] text-xs font-semibold text-[#5d9845]">
              {String(page.order).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-[#4c3e2b]">{page.title}</h4>
                <StatusBadge status={status} />
              </div>
              <p className="mt-1 text-xs leading-5 text-[#988e80]">
                {page.pageType} · {page.interactionType}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#786d5f]">
                {page.contentSummary}
              </p>
            </div>
          </div>
          <ActionButton
            disabled={!canGenerate || status === "running"}
            onClick={onGenerate}
          >
            {status === "running"
              ? "正在生成…"
              : content
                ? "重新生成"
                : "生成 Page DSL"}
          </ActionButton>
        </div>

        {error ? (
          <ErrorNotice>{error}</ErrorNotice>
        ) : content ? (
          <PageDslResult
            canGenerateHtml={canGenerate}
            content={content}
            assetStage={run.pageAssets[page.id]}
            htmlStage={run.pageHtml[page.id]}
            qaStage={run.pageQa[page.id]}
            repairHistory={repairHistory}
            onGenerateHtml={onGenerateHtml}
            onGenerateAssets={onGenerateAssets}
            onEvaluatePage={onEvaluatePage}
            onOpenHtmlPreview={onOpenHtmlPreview}
          />
        ) : null}
      </article>
    </li>
  );
}

function PageDslResult({
  canGenerateHtml,
  content,
  assetStage,
  htmlStage,
  qaStage,
  repairHistory,
  onGenerateHtml,
  onGenerateAssets,
  onEvaluatePage,
  onOpenHtmlPreview,
}: {
  canGenerateHtml: boolean;
  content: PageContentDSL;
  assetStage?: SeacaCourseRun["pageAssets"][string];
  htmlStage?: SeacaCourseRun["pageHtml"][string];
  qaStage?: SeacaCourseRun["pageQa"][string];
  repairHistory: NonNullable<
    NonNullable<SeacaCourseRun["generation"]>["pages"][number]["repairHistory"]
  >;
  onGenerateHtml(): void;
  onGenerateAssets(): void;
  onEvaluatePage(): void;
  onOpenHtmlPreview(): void;
}) {
  const htmlOutput = htmlStage?.data?.state.htmlOutput;
  const assetResults = assetStage?.data?.state.results;
  const assetError = assetStage?.error ?? assetStage?.data?.state.error?.message;
  const assetStatus = assetStage?.status ?? "idle";
  const assetsReady =
    content.assetSlots.length === 0 ||
    (assetStatus === "completed" && Boolean(assetResults));
  const htmlError = htmlStage?.error ?? htmlStage?.data?.state.error?.message;
  const htmlStatus = htmlStage?.status ?? "idle";
  const qaReport = qaStage?.data?.state.report;
  const qaError = qaStage?.error ?? qaStage?.data?.state.error?.message;
  const qaStatus = qaStage?.status ?? "idle";

  return (
    <details className="mt-4 rounded-2xl bg-[#f8f3ec] p-4">
      <summary className="cursor-pointer text-sm font-semibold text-[#594a37] marker:text-[#77b95e]">
        查看页面内容与安全预览
      </summary>
      <div className="mt-4 grid gap-4">
        {content.narration.length > 0 ? (
          <p className="rounded-xl bg-[#fffdf8] p-3 text-sm leading-6 text-[#786d5f]">
            {content.narration.join(" ")}
          </p>
        ) : null}

        {content.blocks.length > 0 ? (
          <ol className="grid gap-2">
            {content.blocks.map((block) => (
              <li
                className="min-w-0 rounded-xl border border-[#e7ddd1] bg-[#fffdf8] p-3"
                key={block.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="h-auto overflow-visible rounded-full border-0 bg-[#eef7e9] px-2 py-0.5 text-[10px] leading-normal font-semibold text-[#5d9845]">
                    {block.kind}
                  </Badge>
                  <h5 className="text-sm font-semibold text-[#4c3e2b]">
                    {block.heading}
                  </h5>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#817568] [overflow-wrap:anywhere]">
                  {block.body}
                </p>
              </li>
            ))}
          </ol>
        ) : null}

        <dl className="grid gap-3 text-xs">
          <MetaField label="互动类型" value={content.interaction.type} />
          <MetaField
            label="素材位置"
            value={`${content.assetSlots.length} 个`}
          />
          <MetaField
            label="内容密度"
            value={content.layoutHints.contentDensity}
          />
        </dl>

        {content.assetSlots.length > 0 ? (
          <section
            aria-labelledby={`page-assets-${content.pageId}`}
            className="border-t border-[#e6ddd1] pt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h5
                    className="text-sm font-semibold text-[#4c3e2b]"
                    id={`page-assets-${content.pageId}`}
                  >
                    页面图片素材
                  </h5>
                  <StatusBadge status={assetStatus} />
                </div>
                <p className="mt-1 text-xs leading-5 text-[#988e80]">
                  每个槽位独立解析；缓存未命中才生图，失败不会阻塞 HTML。
                </p>
              </div>
              <ActionButton
                disabled={!canGenerateHtml || assetStatus === "running"}
                onClick={onGenerateAssets}
              >
                {assetStatus === "running"
                  ? "正在解析素材…"
                  : assetResults
                    ? "重新解析素材"
                    : "生成图片素材"}
              </ActionButton>
            </div>

            {assetError ? (
              <ErrorNotice>{assetError}</ErrorNotice>
            ) : assetResults ? (
              <AssetGallery results={assetResults} />
            ) : (
              <PendingNotice
                idleCopy="先生成页面图片素材，再由 HTML Engineer 完成排版。"
                status={assetStatus}
              />
            )}
          </section>
        ) : null}

        <section
          aria-labelledby={`html-engineer-${content.pageId}`}
          className="border-t border-[#e6ddd1] pt-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h5
                  className="text-sm font-semibold text-[#4c3e2b]"
                  id={`html-engineer-${content.pageId}`}
                >
                  HTML 页面
                </h5>
                <StatusBadge status={htmlStatus} />
              </div>
              <p className="mt-1 text-xs leading-5 text-[#988e80]">
                HTML Engineer 只消费 DSL、模板和视觉 Brief。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {htmlOutput ? (
                <Button
                  className="min-h-10 rounded-full border-[#d9cec0] bg-[#fffdf8] px-4 text-xs font-semibold text-[#5b4c3b] hover:bg-[#f3ede5]"
                  onClick={onOpenHtmlPreview}
                  type="button"
                  variant="outline"
                >
                  独立预览
                </Button>
              ) : null}
              <ActionButton
                disabled={!canGenerateHtml || !assetsReady || htmlStatus === "running"}
                onClick={onGenerateHtml}
              >
                {htmlStatus === "running"
                  ? "正在生成 HTML…"
                  : htmlOutput
                    ? "重新生成 HTML"
                    : "生成 HTML 页面"}
              </ActionButton>
            </div>
          </div>

          {htmlError ? (
            <ErrorNotice>{htmlError}</ErrorNotice>
          ) : htmlOutput ? (
            <div className="mt-4">
              <HtmlPreviewFrame
                html={htmlOutput.html}
                title={`${content.title} · 课程安全预览`}
              />
            </div>
          ) : (
            <PendingNotice
              idleCopy={
                assetsReady
                  ? "Page DSL 与素材已就绪，可以继续生成完整 HTML 页面。"
                  : "请先生成当前页面的图片素材。"
              }
              status={htmlStatus}
            />
          )}

          {htmlOutput ? (
            <section
              aria-labelledby={`page-qa-${content.pageId}`}
              className="mt-4 border-t border-[#e6ddd1] pt-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h5
                      className="text-sm font-semibold text-[#4c3e2b]"
                      id={`page-qa-${content.pageId}`}
                    >
                      页面质量评估
                    </h5>
                    <StatusBadge status={qaStatus} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#988e80]">
                    QA 只报告问题，不会修改当前 HTML。
                  </p>
                </div>
                <ActionButton
                  disabled={!canGenerateHtml || qaStatus === "running"}
                  onClick={onEvaluatePage}
                >
                  {qaStatus === "running"
                    ? "正在评估…"
                    : qaReport
                      ? "重新评估"
                      : "运行页面 QA"}
                </ActionButton>
              </div>

              {qaError ? (
                <ErrorNotice>{qaError}</ErrorNotice>
              ) : qaReport ? (
                <>
                  <RepairLogPanel attempts={repairHistory} />
                  <PageQualityPanel report={qaReport} />
                </>
              ) : (
                <PendingNotice
                  idleCopy="HTML 已就绪，可以运行六维页面质量评估。"
                  status={qaStatus}
                />
              )}
            </section>
          ) : null}
        </section>
      </div>
    </details>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <Button
      className="min-h-10 shrink-0 rounded-full bg-[#77cc57] px-4 py-2 text-xs font-semibold text-[#24351d] transition-colors hover:bg-[#68bd49] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ba83e] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[#e4ded5] disabled:text-[#9a9185] disabled:opacity-100"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  );
}

function StatusBadge({ status }: { status: CourseRunStageStatus }) {
  const className =
    status === "failed"
      ? "bg-[#fff0eb] text-[#a44f3d]"
      : status === "running"
        ? "bg-[#fff4d9] text-[#8a6a23]"
        : status === "completed"
          ? "bg-[#eff7e9] text-[#5d9845]"
          : "bg-[#f0ebe4] text-[#8d8172]";

  return (
    <Badge
      className={`h-auto overflow-visible rounded-full border-0 px-2 py-0.5 text-[10px] leading-normal font-semibold ${className}`}
      variant="secondary"
    >
      {statusCopy[status]}
    </Badge>
  );
}

function WarmTag({ children }: { children: ReactNode }) {
  return (
    <Badge
      className="h-auto overflow-visible rounded-full border border-[#e6ddd1] bg-[#f8f3ec] px-3 py-1 text-xs font-normal text-[#6f6355]"
      variant="outline"
    >
      {children}
    </Badge>
  );
}

function BriefCard({
  eyebrow,
  title,
  description,
  detail,
}: {
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-[#e9dfd3] bg-[#fffefa] p-4">
      <p className="text-[10px] font-semibold tracking-[0.08em] text-[#77a863]">
        {eyebrow}
      </p>
      <h4 className="mt-1.5 text-sm font-semibold text-[#4c3e2b] [overflow-wrap:anywhere]">
        {title}
      </h4>
      <p className="mt-2 text-xs leading-5 text-[#786d5f]">{description}</p>
      <p className="mt-3 border-t border-[#eee5da] pt-3 text-xs leading-5 text-[#988e80]">
        {detail}
      </p>
    </article>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[#fffdf8] p-3">
      <dt className="text-[#9a9084]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#594a37] [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function PendingNotice({
  status,
  idleCopy,
}: {
  status: CourseRunStageStatus;
  idleCopy: string;
}) {
  return (
    <p
      aria-live="polite"
      className="mt-4 rounded-2xl bg-[#f8f3ec] px-4 py-4 text-sm leading-6 text-[#8d8172]"
    >
      {status === "running"
        ? "Agent 正在生成，请稍候…"
        : status === "failed"
          ? "生成未完成，请稍后重试。"
          : idleCopy}
    </p>
  );
}

function ErrorNotice({ children }: { children?: ReactNode }) {
  return (
    <Alert
      className="mt-4 rounded-2xl border border-[#edc4b9] bg-[#fff0eb] px-4 py-3 text-sm leading-6 text-[#984735]"
      variant="destructive"
    >
      {children ?? "生成失败，请稍后重试。"}
    </Alert>
  );
}
