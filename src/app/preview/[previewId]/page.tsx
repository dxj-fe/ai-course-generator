import { CoursePreviewPage } from "@/features/keya/course-preview-page";
import { htmlPreviewStore } from "@/server/storage/html-preview-store";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = await params;
  const preview = await htmlPreviewStore.load(previewId);

  return <CoursePreviewPage preview={preview} />;
}
