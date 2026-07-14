import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { CourseLibrary } from "@/features/seaca/course-library";

export const metadata: Metadata = {
  title: "我的课程",
  description: "查看学习、作品、点赞与收藏。",
};

export default function CoursePage() {
  return (
    <>
      <SiteHeader />
      <div className="pt-16">
        <CourseLibrary />
      </div>
    </>
  );
}
