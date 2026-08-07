import { purgeFailedCourses } from "../src/server/course/maintenance/purge-failed-courses";

async function main() {
  const confirmed = process.argv.includes("--confirm");
  const report = await purgeFailedCourses({ dryRun: !confirmed });

  console.log(JSON.stringify(report, null, 2));
  if (!confirmed && report.failedCourseIds.length > 0) {
    console.log(
      "\n当前为 dry-run；确认清理请执行 pnpm data:purge-failed -- --confirm",
    );
  }
}

void main();
