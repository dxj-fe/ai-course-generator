import { readFile } from "node:fs/promises";

import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";
import { compareCourseQuality } from "@/server/quality/course-quality-comparison";

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  throw new Error(
    "用法：npm run quality:compare -- <baseline-course.json> <candidate-course.json>",
  );
}

const [baseline, candidate] = await Promise.all([
  loadCourse(baselinePath),
  loadCourse(candidatePath),
]);
const comparison = compareCourseQuality(baseline, candidate);
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
if (comparison.winner === "baseline") process.exitCode = 1;

async function loadCourse(filePath: string): Promise<CourseGenerationState> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  const course =
    parsed &&
    typeof parsed === "object" &&
    "course" in parsed &&
    (parsed as { course?: unknown }).course
      ? (parsed as { course: unknown }).course
      : parsed;
  return CourseGenerationStateSchema.parse(course);
}
