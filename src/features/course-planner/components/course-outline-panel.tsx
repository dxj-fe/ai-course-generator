import type { CoursePlan } from "@/shared/course-schema";

/** 展示 CoursePlannerAgent 生成的全局概述和学习目标。 */
export function CourseOutlinePanel({ outline }: { outline: CoursePlan }) {
  return (
    <section
      className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-5"
      aria-labelledby="course-outline-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          className="text-lg font-semibold text-[#14532d]"
          id="course-outline-title"
        >
          Course Outline
        </h3>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#15803d]">
          {outline.pages.length} 页
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#166534]">
        {outline.overview}
      </p>
      <h4 className="mt-4 text-sm font-semibold text-[#14532d]">学习目标</h4>
      <ol className="mt-2 grid gap-2 text-sm leading-6 text-[#166534] sm:grid-cols-2">
        {outline.learningObjectives.map((objective, index) => (
          <li className="flex gap-2" key={objective}>
            <span className="font-mono text-xs font-bold text-[#16a34a]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{objective}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
