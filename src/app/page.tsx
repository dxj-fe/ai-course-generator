import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { HomeHero } from "@/features/keya/home-hero";
import { RecommendedCourseShowcase } from "@/features/keya/recommended-course-showcase";
import { listRecommendedCourses } from "@/server/recommendations/recommended-course-registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "探索",
  description: "发现精选示例课程，或者从一次对话开始学习。",
};

interface HomeProps {
  searchParams?: Promise<{
    recommendationCursor?: string;
  }>;
}

export default async function Home({ searchParams }: HomeProps = {}) {
  const params = searchParams ? await searchParams : {};
  const parsedCursor = Number(params.recommendationCursor ?? 0);
  const cursor =
    Number.isInteger(parsedCursor) &&
    parsedCursor >= 0 &&
    parsedCursor <= 10_000
      ? parsedCursor
      : 0;
  const recommendations = listRecommendedCourses(cursor);

  return (
    <>
      <SiteHeader />
      <main className="keya-home-page pt-16">
        <HomeHero />
        <RecommendedCourseShowcase initialData={recommendations} />
      </main>
    </>
  );
}
