"use client";

import { useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { CourseDesignBriefs } from "@/shared/course-schema";

type BriefTab = keyof CourseDesignBriefs;

const tabs: { id: BriefTab; label: string }[] = [
  { id: "pedagogy", label: "教学设计" },
  { id: "story", label: "故事设计" },
  { id: "visual", label: "视觉设计" },
];

/** 使用三个可访问 Tab 展示不同专业 Agent 的结构化交付。 */
export function CourseDesignTabs({ briefs }: { briefs: CourseDesignBriefs }) {
  const [activeTab, setActiveTab] = useState<BriefTab>("pedagogy");

  return (
    <Tabs
      asChild
      className="block rounded-xl border border-[#d8dee8] bg-white shadow-sm"
      onValueChange={(value) => setActiveTab(value as BriefTab)}
      value={activeTab}
    >
      <section>
        <TabsList
          aria-label="专业设计 Brief"
          className="flex h-auto w-full justify-stretch gap-1 rounded-none border-b border-[#d8dee8] bg-transparent p-2 text-inherit group-data-horizontal/tabs:h-auto"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              aria-controls={`${tab.id}-brief-panel`}
              aria-selected={activeTab === tab.id}
              className={`h-auto min-h-10 flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? "bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ede9fe] hover:text-[#6d28d9]"
                  : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#344054]"
              }`}
              id={`${tab.id}-brief-tab`}
              key={tab.id}
              value={tab.id}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="p-5">
          <TabsContent
            aria-labelledby="pedagogy-brief-tab"
            className="text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
            forceMount
            hidden={activeTab !== "pedagogy"}
            id="pedagogy-brief-panel"
            tabIndex={0}
            value="pedagogy"
          >
            <PedagogyBrief brief={briefs.pedagogy} />
          </TabsContent>
          <TabsContent
            aria-labelledby="story-brief-tab"
            className="text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
            forceMount
            hidden={activeTab !== "story"}
            id="story-brief-panel"
            tabIndex={0}
            value="story"
          >
            <StoryBrief brief={briefs.story} />
          </TabsContent>
          <TabsContent
            aria-labelledby="visual-brief-tab"
            className="text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
            forceMount
            hidden={activeTab !== "visual"}
            id="visual-brief-panel"
            tabIndex={0}
            value="visual"
          >
            <VisualBriefPanel brief={briefs.visual} />
          </TabsContent>
        </div>
      </section>
    </Tabs>
  );
}

/** 展示年龄适配、互动节奏和逐页教学脚手架。 */
function PedagogyBrief({
  brief,
}: {
  brief: CourseDesignBriefs["pedagogy"];
}) {
  return (
    <div className="grid gap-5">
      <BriefHeader title="PedagogyPlan" description={brief.audienceSummary} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <BriefField label="阅读水平" value={brief.ageAdaptation.readingLevel} />
        <BriefField label="表达语气" value={brief.ageAdaptation.tone} />
        <BriefField
          label="解释深度"
          value={brief.ageAdaptation.explanationDepth}
        />
        <BriefField
          label="内容分块"
          value={brief.ageAdaptation.chunkingStrategy}
        />
      </dl>
      <p className="rounded-lg bg-[#f0fdf4] p-3 text-sm leading-6 text-[#166534]">
        每 {brief.interactionCadence.recommendedIntervalPages} 页安排一次互动；
        最多连续 {brief.interactionCadence.maxPassivePages} 页被动内容。
        {brief.interactionCadence.strategy}
      </p>
      <PageCards
        items={brief.pageGuidance.map((item) => ({
          id: item.pageId,
          title: item.cognitiveLevel,
          description: item.interactionPurpose,
          detail: `理解检查：${item.checkForUnderstanding}`,
        }))}
      />
    </div>
  );
}

/** 展示学习者角色、任务和跨页转场，而不输出页面正文。 */
function StoryBrief({
  brief,
}: {
  brief: CourseDesignBriefs["story"];
}) {
  return (
    <div className="grid gap-5">
      <BriefHeader title="StoryArc" description={brief.premise} />
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <BriefField label="叙事强度" value={brief.narrativeMode} />
        <BriefField label="学习者角色" value={brief.learnerRole} />
        <BriefField label="整体语气" value={brief.tone} />
      </dl>
      <p className="rounded-lg bg-[#fff7ed] p-3 text-sm leading-6 text-[#9a3412]">
        <strong>任务：</strong>
        {brief.mission}
      </p>
      <PageCards
        items={brief.pageBeats.map((item) => ({
          id: item.pageId,
          title: "Story beat",
          description: item.beat,
          detail: `转场：${item.transition}`,
        }))}
      />
    </div>
  );
}

/** 展示对 StyleTemplate 的引用、视觉原则和逐页构图指导。 */
function VisualBriefPanel({
  brief,
}: {
  brief: CourseDesignBriefs["visual"];
}) {
  return (
    <div className="grid gap-5">
      <BriefHeader title="VisualBrief" description={brief.visualConcept} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <BriefField label="StyleTemplate" value={brief.styleTemplateId} />
        <BriefField
          label="动效强度"
          value={brief.motionGuidance.intensity}
        />
        <BriefField label="排版指导" value={brief.typographyGuidance} />
        <BriefField label="颜色使用" value={brief.colorUsage} />
      </dl>
      <ul className="grid gap-2 text-sm text-[#475569] sm:grid-cols-2">
        {brief.layoutPrinciples.map((principle) => (
          <li className="rounded-lg bg-[#f8fafc] p-3" key={principle}>
            {principle}
          </li>
        ))}
      </ul>
      <PageCards
        items={brief.pageGuidance.map((item) => ({
          id: item.pageId,
          title: item.focalPoint,
          description: item.composition,
          detail: `素材作用：${item.assetPurpose}`,
        }))}
      />
    </div>
  );
}

/** 统一三个 Tab 的标题和摘要层级。 */
function BriefHeader({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <h4 className="text-lg font-semibold text-[#101827]">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-[#64748b]">{description}</p>
    </header>
  );
}

/** 用 definition list 展示一项不可编辑的专业约束。 */
function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e2e8f0] p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
        {label}
      </dt>
      <dd className="mt-1 leading-6 text-[#344054]">{value}</dd>
    </div>
  );
}

/** 按稳定 pageId 展示 Page Worker 将消费的逐页指导。 */
function PageCards({
  items,
}: {
  items: { id: string; title: string; description: string; detail: string }[];
}) {
  return (
    <ol className="grid gap-3">
      {items.map((item, index) => (
        <li
          className="rounded-lg border border-[#e2e8f0] bg-[#fbfdff] p-3"
          key={item.id}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-[#7c3aed]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-xs text-[#64748b]">{item.id}</span>
            <strong className="text-sm text-[#344054]">{item.title}</strong>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#475569]">
            {item.description}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#64748b]">{item.detail}</p>
        </li>
      ))}
    </ol>
  );
}
