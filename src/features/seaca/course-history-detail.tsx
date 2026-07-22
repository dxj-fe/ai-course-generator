"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  downloadCourseArchive,
  getCourseHistoryDetail,
} from "@/features/course-planner/lib/course-library-api";
import { CoursePreviewGrid } from "@/features/seaca/course-preview-grid";
import type { CourseHistoryDetailResponse } from "@/shared/course-schema";

export function CourseHistoryDetail({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<CourseHistoryDetailResponse>();
  const [error, setError] = useState<string>();
  const [exportError, setExportError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getCourseHistoryDetail(courseId, controller.signal)
      .then(setDetail)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "课程加载失败。");
      });
    return () => controller.abort();
  }, [courseId, reloadKey]);

  if (error) return <DetailError message={error} onRetry={() => { setError(undefined); setReloadKey((value) => value + 1); }} />;
  if (!detail) return <div aria-live="polite" className="flex min-h-[55vh] items-center justify-center gap-2 text-sm text-[#817568]"><LoaderCircle className="size-4 animate-spin" /> 正在加载持久化课程…</div>;

  const course = detail.course;
  const previewPages = (course.outline?.pages ?? []).map((page) => {
    const state = course.pages.find(({ pageId }) => page.id === pageId);
    return {
      id: page.id,
      order: page.order,
      title: page.title,
      status: state?.status === "completed" ? "completed" as const : state?.status === "failed" ? "failed" as const : state?.status === "running" ? "running" as const : "idle" as const,
      htmlOutput: state?.htmlOutput?.html,
      error: state?.error?.message,
    };
  });
  const handleExport = async () => {
    setExportError(undefined);
    setExporting(true);
    try { await downloadCourseArchive(course.courseId); }
    catch (downloadError) { setExportError(downloadError instanceof Error ? downloadError.message : "课程导出失败。"); }
    finally { setExporting(false); }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#fcf9f2] pb-16 text-[#382c19]">
      <div className="mx-auto w-[calc(100%-32px)] max-w-[1200px] pt-7 sm:w-[calc(100%-48px)]">
        <Button asChild variant="ghost" className="rounded-full text-[#6f6355]"><Link href="/course"><ArrowLeft /> 返回课程历史</Link></Button>
        <header className="mt-5 rounded-[26px] border border-[#e6ddd1] bg-[#fffdf8] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <Badge className="border-0 bg-[#eff8e9] text-[#4f8938]">{course.status === "completed" ? "已完成" : course.status === "running" ? "生成中" : course.status === "failed" ? "生成失败" : "已取消"}</Badge>
              <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{course.intent?.topic ?? course.userPrompt}</h1>
              <p className="mt-3 text-sm leading-6 text-[#817568]">{course.outline?.overview ?? course.userPrompt}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {course.status !== "completed" ? <Button asChild className="rounded-full" variant="outline"><Link href={`/chat?course=${encodeURIComponent(course.courseId)}`}><RotateCcw /> 从检查点继续</Link></Button> : null}
              <Button className="rounded-full bg-[#77cc57] text-[#1f3b16] hover:bg-[#6bc04d]" disabled={course.status !== "completed" || exporting} onClick={handleExport}>
                {exporting ? <LoaderCircle className="animate-spin" /> : <Download />} {exporting ? "正在导出…" : "导出课程 ZIP"}
              </Button>
            </div>
          </div>
          {exportError ? <Alert className="mt-4 border-[#edc4b9] bg-[#fff0eb] text-[#984735]" variant="destructive"><TriangleAlert />{exportError}</Alert> : null}
          <dl className="mt-6 grid gap-3 border-t border-[#eee5da] pt-5 text-sm sm:grid-cols-4">
            <Meta label="页面" value={`${course.pages.filter(({ status }) => status === "completed").length}/${course.outline?.pages.length ?? course.pages.length}`} />
            <Meta label="运行记录" value={`${detail.runs.length} 次`} />
            <Meta label="运行源" value={detail.runs[0]?.source ?? "未知"} />
            <Meta label="最近更新" value={formatDate(course.updatedAt)} />
          </dl>
        </header>

        <section className="mt-6"><CoursePreviewGrid pages={previewPages} /></section>

        <section aria-labelledby="run-history-title" className="mt-6 rounded-[24px] border border-[#e6ddd1] bg-[#fffdf8] p-5">
          <h2 id="run-history-title" className="text-lg font-semibold">运行记录</h2>
          {detail.runs.length ? <ol className="mt-4 grid gap-3">{detail.runs.map((run) => <li className="rounded-2xl bg-[#f8f3ec] px-4 py-3 text-sm" key={run.taskId}><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{run.source === "langgraph" ? "LangGraph" : "Workflow"} · {run.status}</span><time className="text-[#988e80]">{formatDate(run.createdAt)}</time></div>{run.error ? <p className="mt-2 text-[#a44f3d]">{run.error.message}</p> : null}</li>)}</ol> : <p className="mt-3 text-sm text-[#988e80]">没有关联的任务记录。</p>}
        </section>
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-[#988e80]">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function DetailError({ message, onRetry }: { message: string; onRetry(): void }) { return <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-[#fcf9f2] px-6 text-center text-[#382c19]" role="alert"><div><TriangleAlert className="mx-auto size-9 text-[#b65e49]" /><h1 className="mt-3 font-semibold">课程无法打开</h1><p className="mt-2 text-sm text-[#988e80]">{message}</p><Button className="mt-4 rounded-full" onClick={onRetry} variant="outline"><RefreshCw />重试</Button></div></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
