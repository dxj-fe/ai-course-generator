import type { Metadata } from "next";

import { TemplateGallery } from "@/features/template-gallery/components/template-gallery";

export const metadata: Metadata = {
  title: "功能模板清单 | AI Course Generator",
  description: "查看 AI Course Generator 的功能模板、结构槽位和 PagePlan 示例。",
};

/** Day 08 功能模板 Gallery 路由。 */
export default function TemplatesPage() {
  return <TemplateGallery />;
}
