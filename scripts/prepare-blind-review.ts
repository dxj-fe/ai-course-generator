import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCourseBlindReviewPacket } from "@/server/course/page/quality/blind-review";

const [baselinePath, candidatePath, outputPath, seed = "keya-blind-review"] =
  process.argv.slice(2);
if (!baselinePath || !candidatePath || !outputPath) {
  throw new Error(
    "用法：npm run quality:blind -- <baseline-course.json> <candidate-course.json> <output-dir> [seed]",
  );
}

const [baseline, candidate] = await Promise.all([
  loadCourse(baselinePath),
  loadCourse(candidatePath),
]);
const packet = buildCourseBlindReviewPacket({ baseline, candidate, seed });
await mkdir(outputPath, { recursive: true });

for (const variant of packet.variants) {
  const variantDirectory = path.join(outputPath, variant.label);
  await mkdir(variantDirectory, { recursive: true });
  await Promise.all(
    variant.pages.map((page) =>
      writeFile(path.join(variantDirectory, page.fileName), page.html, "utf8"),
    ),
  );
}

await Promise.all([
  writeFile(
    path.join(outputPath, "packet.json"),
    `${JSON.stringify(
      {
        prompt: packet.prompt,
        dimensions: packet.dimensions,
        variants: packet.variants.map((variant) => ({
          label: variant.label,
          pages: variant.pages.map(({ order, title, fileName }) => ({
            order,
            title,
            file: `${variant.label}/${fileName}`,
          })),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputPath, "review-form.md"),
    reviewForm(packet.prompt),
    "utf8",
  ),
  writeFile(
    path.join(outputPath, "answer-key.json"),
    `${JSON.stringify(packet.answerKey, null, 2)}\n`,
    "utf8",
  ),
]);

process.stdout.write(`盲测包已写入 ${path.resolve(outputPath)}\n`);

async function loadCourse(filePath: string) {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  return parsed && typeof parsed === "object" && "course" in parsed
    ? (parsed as { course: unknown }).course
    : parsed;
}

function reviewForm(prompt: string) {
  const rows = [
    "| 维度 | A（1-5） | B（1-5） | 更好的一方 | 证据 |",
    "| --- | ---: | ---: | --- | --- |",
    ...[
      "知识深度与准确性",
      "教学有效性",
      "视觉完成度与信息表达",
      "互动价值",
      "跨页连贯性",
    ].map((label) => `| ${label} |  |  |  |  |`),
  ];
  return `# 课程 A/B 盲测\n\n课程请求：${prompt}\n\n请按页面顺序分别查看 A、B。不要查看 answer-key.json，先独立完成评分。\n\n${rows.join("\n")}\n\n总体偏好：\n\n严重事实、安全或失效互动问题：\n\n最关键的改进建议：\n`;
}
