import type { Metadata } from "next";

import { TemplateGallery } from "@/features/template-gallery/components/template-gallery";

export const metadata: Metadata = {
  title: "模板系统清单 | AI Course Generator",
  description:
    "查看 AI Course Generator 的功能模板、样式模板、Design Tokens 和 PagePlan 示例。",
};

/** Day 08–09 功能与样式模板 Gallery 路由。 */
export default function TemplatesPage() {
  return <TemplateGallery />;
}
