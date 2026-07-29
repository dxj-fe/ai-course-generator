import type { Metadata } from "next";

import { CourseFlowInspector } from "@/features/course-flow-inspector/course-flow-inspector";

export const metadata: Metadata = {
  title: "课程生成链路分析",
  description: "一句话生成课程的交互式流程图与节点诊断说明。",
};

export default function CourseGenerationAnalysisPage() {
  return <CourseFlowInspector />;
}
