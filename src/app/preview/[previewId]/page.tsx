import { CoursePreviewPage } from "@/features/seaca/course-preview-page";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = await params;

  return <CoursePreviewPage previewId={previewId} />;
}
