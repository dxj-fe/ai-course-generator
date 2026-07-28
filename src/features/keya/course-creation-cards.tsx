"use client";

import { useState } from "react";
import {
  BookOpen,
  Check,
  Circle,
  CircleCheck,
  Pencil,
  Sparkles,
  Sprout,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ClarificationQuestion,
  ClarificationQuestionId,
  CourseCreationBrief,
} from "@/features/keya/course-creation-model";

type CourseCreationCardsProps = {
  brief: CourseCreationBrief;
  busy?: boolean;
  question?: ClarificationQuestion;
  onAnswer(answer: string, questionId?: ClarificationQuestionId): void;
  onConfirm(): void;
};

export function CourseCreationCards({
  brief,
  busy = false,
  question,
  onAnswer,
  onConfirm,
}: CourseCreationCardsProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-3">
        <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm">
          <Sprout aria-hidden="true" size={20} strokeWidth={1.8} />
        </span>
        <CourseBriefCard
          brief={brief}
          editing={editing}
          onAnswer={onAnswer}
          onToggleEdit={() => setEditing((value) => !value)}
        />
      </div>

      {question ? (
        <ClarificationCard
          busy={busy}
          onAnswer={onAnswer}
          question={question}
        />
      ) : (
        <div className="ml-[52px] flex flex-wrap items-center gap-3">
          <Button
            className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--keya-sprout-dark)]"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            <Sparkles aria-hidden="true" size={17} strokeWidth={1.8} />
            开始生成课程
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            生成后仍可继续补充要求，已完成内容会保留。
          </p>
        </div>
      )}

      <CourseJourney activeStep={1} />
    </div>
  );
}

export function CourseBriefCard({
  brief,
  editing = false,
  onAnswer,
  onToggleEdit,
}: {
  brief: CourseCreationBrief;
  editing?: boolean;
  onAnswer?(answer: string, questionId?: ClarificationQuestionId): void;
  onToggleEdit?(): void;
}) {
  return (
    <section
      aria-labelledby="course-brief-title"
      className="min-w-0 flex-1 rounded-[22px] border border-border bg-card px-5 py-5 shadow-[var(--keya-card-shadow)] sm:px-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground" id="course-brief-title">
          课程简报
        </h2>
        {onToggleEdit ? (
          <Button
            aria-expanded={editing}
            className="h-8 rounded-full px-2.5 text-xs text-primary hover:bg-[var(--keya-pill)] hover:text-[var(--keya-sprout-dark)]"
            onClick={onToggleEdit}
            type="button"
            variant="ghost"
          >
            <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
            {editing ? "完成" : "修改"}
          </Button>
        ) : null}
      </div>

      <dl
        aria-live="polite"
        className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[96px_minmax(0,1fr)]"
      >
        <BriefField label="课程主题" value={brief.topic} />
        <BriefField label="适合" value={brief.audience} />
        <BriefField
          label="学习目标"
          value={brief.goal ?? "等待你的选择"}
        />
        <BriefField
          label="内容"
          value={
            brief.sectionCount === undefined || brief.sectionCount === "auto"
              ? "由课芽按内容深度规划"
              : `${brief.sectionCount} 节`
          }
        />
        <BriefField
          label="学习方式"
          value={learningModeCopy[brief.learningMode]}
        />
      </dl>

      {editing && onAnswer ? (
        <div className="mt-5 grid gap-4 border-t border-border pt-4">
          <PresetGroup
            label="适合对象"
            onAnswer={(answer) => onAnswer(answer)}
            options={[
              { label: "零基础", value: "零基础" },
              { label: "初学者", value: "初学者" },
              { label: "有一定基础", value: "有一定基础" },
            ]}
            value={brief.audience}
          />
          <PresetGroup
            label="学习方式"
            onAnswer={(answer) => onAnswer(answer)}
            options={[
              { answer: "讲解为主", label: "讲解为主", value: "guided" },
              {
                answer: "互动练习为主",
                label: "互动练习为主",
                value: "practice",
              },
              {
                answer: "讲解 + 互动",
                label: "讲解 + 互动",
                value: "mixed",
              },
            ]}
            value={brief.learningMode}
          />
        </div>
      ) : null}
    </section>
  );
}

export function CourseJourney({
  activeStep,
  className = "",
}: {
  activeStep: 1 | 2 | 3;
  className?: string;
}) {
  const steps = ["确认课程", "生成内容", "开始学习"] as const;

  return (
    <ol
      aria-label="课程创建进度"
      className={`mx-auto flex w-full max-w-[560px] items-start ${className}`}
    >
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const completed = step < activeStep;
        const active = step === activeStep;
        return (
          <li className="flex min-w-0 flex-1 items-start last:flex-none" key={label}>
            <div className="grid justify-items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={`flex size-9 items-center justify-center rounded-full border text-sm font-semibold ${
                  completed || active
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-[var(--keya-pill)] text-[var(--keya-muted-soft)]"
                }`}
              >
                {completed ? (
                  <Check aria-hidden="true" size={16} strokeWidth={2.2} />
                ) : (
                  step
                )}
              </span>
              <span
                className={`whitespace-nowrap text-xs font-medium ${
                  completed || active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {step < 3 ? (
              <span
                aria-hidden="true"
                className={`mx-3 mt-[17px] h-0.5 min-w-6 flex-1 rounded-full ${
                  step < activeStep ? "bg-primary" : "bg-border"
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ClarificationCard({
  busy,
  onAnswer,
  question,
}: {
  busy: boolean;
  onAnswer(answer: string, questionId?: ClarificationQuestionId): void;
  question: ClarificationQuestion;
}) {
  return (
    <section
      aria-labelledby={`clarification-${question.id}`}
      className="ml-[52px] rounded-[22px] border border-[#d9e8dc] bg-[#f2f7f2] p-5"
    >
      <div className="flex gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sm">
          <BookOpen aria-hidden="true" size={16} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p
            className="text-sm font-semibold leading-6 text-foreground"
            id={`clarification-${question.id}`}
          >
            {question.prompt}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            只确认这一项；你也可以直接在下方输入自己的答案。
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 pl-11">
        {question.options.map((option) => (
          <Button
            className={`h-auto min-h-10 rounded-xl border px-3.5 py-2 text-left text-xs font-medium ${
              option.recommended
                ? "border-primary bg-primary text-white hover:bg-[var(--keya-sprout-dark)]"
                : "border-border bg-card text-[var(--keya-ink-soft)] hover:bg-[var(--keya-pill)]"
            }`}
            disabled={busy}
            key={option.value}
            onClick={() => onAnswer(option.value, question.id)}
            type="button"
            variant={option.recommended ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{value}</dd>
    </>
  );
}

function PresetGroup({
  label,
  onAnswer,
  options,
  value,
}: {
  label: string;
  onAnswer(answer: string): void;
  options: Array<{ answer?: string; label: string; value: string }>;
  value: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label className="cursor-pointer" key={option.value}>
            <input
              checked={value === option.value}
              className="peer sr-only"
              name={`course-brief-${label}`}
              onChange={() => onAnswer(option.answer ?? option.label)}
              type="radio"
              value={option.value}
            />
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs font-medium text-[var(--keya-ink-soft)] transition-[color,background-color,border-color,box-shadow] hover:bg-[var(--keya-pill)] peer-checked:border-primary peer-checked:bg-[#e8f3ea] peer-checked:text-[var(--keya-sprout-dark)] peer-checked:shadow-[inset_0_0_0_1px_var(--keya-sprout)] peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--keya-paper)]">
              {value === option.value ? (
                <CircleCheck
                  aria-hidden="true"
                  className="fill-primary text-white"
                  size={16}
                  strokeWidth={2.2}
                />
              ) : (
                <Circle
                  aria-hidden="true"
                  className="text-[var(--keya-muted-soft)]"
                  size={16}
                  strokeWidth={1.8}
                />
              )}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const learningModeCopy: Record<CourseCreationBrief["learningMode"], string> = {
  guided: "讲解为主",
  practice: "互动练习为主",
  mixed: "讲解 + 互动练习",
};
