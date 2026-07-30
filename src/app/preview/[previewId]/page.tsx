import { CoursePreviewPage } from "@/features/keya/course-preview-page";
import { getWebServices } from "@/server/setup/web";

export const dynamic = "force-dynamic";

const { previews } = getWebServices();

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = await params;
  const preview = await previews.load(previewId);

  return <CoursePreviewPage preview={preview} />;
}
