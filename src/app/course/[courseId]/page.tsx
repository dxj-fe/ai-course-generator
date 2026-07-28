import type { Metadata } from "next";

import { CourseHistoryDetail } from "@/features/keya/course-history-detail";

export const metadata: Metadata = {
  title: "课程详情",
  description: "查看持久化课程、运行记录并导出交付包。",
};

export default async function CourseDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <CourseHistoryDetail courseId={courseId} />;
}
