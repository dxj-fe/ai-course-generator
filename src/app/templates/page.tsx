import type { Metadata } from "next";

import { TemplateGallery } from "@/features/template-gallery/components/template-gallery";

export const metadata: Metadata = {
  title: "课程模板花园",
  description: "浏览课芽的功能模板、样式主题与课程页面示例。",
};

/** 功能与样式模板 Gallery 路由。 */
export default function TemplatesPage() {
  return <TemplateGallery />;
}
