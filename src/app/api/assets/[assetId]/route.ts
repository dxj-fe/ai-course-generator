import { loadGeneratedAsset } from "@/server/assets/generated-asset-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const asset = await loadGeneratedAsset(assetId);

  if (!asset) {
    return Response.json({ message: "素材不存在或已失效。" }, { status: 404 });
  }

  return new Response(asset.bytes, {
    headers: {
      "Cache-Control": "private, max-age=86400, immutable",
      "Content-Length": String(asset.bytes.byteLength),
      "Content-Type": asset.mediaType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
