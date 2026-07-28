import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { HomeHero } from "@/features/keya/home-hero";
import { WorkGallery } from "@/features/keya/work-gallery";
import { courseHistoryService } from "@/server/courses/course-history-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "探索",
  description: "发现课程作品，或者从一次对话开始学习。",
};

export default async function Home() {
  const history = await courseHistoryService.list();
  const completedCourses = history.items.filter(
    (course) =>
      course.status === "completed" &&
      course.exportable &&
      course.totalPages > 0 &&
      course.completedPages === course.totalPages &&
      (!course.latestRun || course.latestRun.status === "completed"),
  );

  return (
    <>
      <SiteHeader />
      <div className="pt-16">
        <HomeHero featuredWorks={completedCourses.slice(0, 3)} />
        <WorkGallery works={history.items} />
      </div>
    </>
  );
}
