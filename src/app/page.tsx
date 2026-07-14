import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";
import { HomeHero } from "@/features/seaca/home-hero";
import { WorkGallery } from "@/features/seaca/work-gallery";

export const metadata: Metadata = {
  title: "探索",
  description: "发现课程作品，或者从一次对话开始学习。",
};

export default function Home() {
  return (
    <>
      <SiteHeader />
      <div className="pt-16">
        <HomeHero />
        <WorkGallery />
      </div>
    </>
  );
}
