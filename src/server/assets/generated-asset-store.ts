import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ASSET_ROOT_DIRECTORY = path.join(
  process.cwd(),
  ".data",
  "generated-assets",
);
const ASSET_ID_PATTERN = /^asset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

type SupportedMediaType = keyof typeof MEDIA_EXTENSIONS;

export type RasterImageInfo = {
  mediaType: SupportedMediaType;
  width?: number;
  height?: number;
  supportsTransparency: boolean | undefined;
};

/** 验证 MIME、魔数和基础尺寸，拒绝 SVG/HTML 或伪造扩展名。 */
export function inspectRasterImage(
  bytes: Uint8Array,
  declaredMediaType: string,
): RasterImageInfo {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("生成图片为空或超过 10MB 上限。");
  }

  if (isPng(bytes) && declaredMediaType === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      mediaType: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
      supportsTransparency: [4, 6].includes(bytes[25] ?? -1),
    };
  }

  if (isJpeg(bytes) && declaredMediaType === "image/jpeg") {
    const dimensions = readJpegDimensions(bytes);
    return {
      mediaType: "image/jpeg",
      ...dimensions,
      supportsTransparency: false,
    };
  }

  if (isWebp(bytes) && declaredMediaType === "image/webp") {
    return {
      mediaType: "image/webp",
      supportsTransparency: undefined,
    };
  }

  throw new Error("图片 MIME 与文件签名不一致，或格式不受支持。");
}

/** 将已验证图片写入运行时目录，返回不暴露文件名的内部 URI。 */
export async function saveGeneratedAsset(
  bytes: Uint8Array,
  mediaType: SupportedMediaType,
) {
  inspectRasterImage(bytes, mediaType);
  const id = `asset-${crypto.randomUUID()}`;
  const extension = MEDIA_EXTENSIONS[mediaType];

  await mkdir(ASSET_ROOT_DIRECTORY, { recursive: true });
  await writeFile(path.join(ASSET_ROOT_DIRECTORY, `${id}.${extension}`), bytes, {
    flag: "wx",
  });

  return { id, uri: `/api/assets/${id}` };
}

/** 只按随机 ID 查找允许的图片扩展名，不接受调用方提供路径。 */
export async function loadGeneratedAsset(
  id: string,
) {
  if (!ASSET_ID_PATTERN.test(id)) return undefined;

  for (const [mediaType, extension] of Object.entries(MEDIA_EXTENSIONS)) {
    const filePath = path.join(ASSET_ROOT_DIRECTORY, `${id}.${extension}`);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_IMAGE_BYTES) return undefined;
      return {
        bytes: await readFile(filePath),
        mediaType: mediaType as SupportedMediaType,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return undefined;
}

function isPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((value, index) => bytes[index] === value);
}

function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array) {
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    const length = ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) + (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) + (bytes[offset + 8] ?? 0),
      };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return {};
}
