"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronDown as ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CourseTaskConnectionStatus } from "@/features/course-planner/hooks/use-sse-task";
import { CourseCreationCards } from "@/features/keya/course-creation-cards";
import type {
  ClarificationQuestion,
  ClarificationQuestionId,
  CourseCreationBrief,
} from "@/features/keya/course-creation-model";
import { CourseRunTimeline } from "@/features/keya/course-run-timeline";
import type { CourseTaskStatus } from "@/shared/course-schema";
import type { KeyaConversation } from "@/types/keya";

interface ChatThreadProps {
  busy?: boolean;
  connectionStatus?: CourseTaskConnectionStatus;
  conversation: KeyaConversation | null;
  courseBrief?: CourseCreationBrief;
  courseQuestion?: ClarificationQuestion;
  onAnswerCourseQuestion?(
    answer: string,
    questionId?: ClarificationQuestionId,
  ): void;
  onConfirmCourse?(): void;
  onOpenCoursePlayer?(): void;
  onResumeCourse?(): void;
  taskStatus?: CourseTaskStatus;
}

export function ChatThread({
  busy = false,
  connectionStatus,
  conversation,
  courseBrief,
  courseQuestion,
  onAnswerCourseQuestion,
  onConfirmCourse,
  onOpenCoursePlayer,
  onResumeCourse,
  taskStatus,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const previousMessageCountRef = useRef(-1);
  const [showLatest, setShowLatest] = useState(false);
  const messageCount = conversation?.messages.length ?? 0;
  const courseRunRevision = conversation?.courseRun
    ? [
        conversation.courseRun.planner.status,
        conversation.courseRun.planner.events.length,
        conversation.courseRun.design.status,
        conversation.courseRun.design.events.length,
        ...Object.entries(conversation.courseRun.pageWrites).flatMap(
          ([pageId, stage]) => [
            pageId,
            stage.status,
            stage.events.length,
          ],
        ),
        ...Object.entries(conversation.courseRun.pageAssets).flatMap(
          ([pageId, stage]) => [
            pageId,
            stage.status,
            stage.events.length,
          ],
        ),
        ...Object.entries(conversation.courseRun.pageHtml).flatMap(
          ([pageId, stage]) => [
            pageId,
            stage.status,
            stage.events.length,
          ],
        ),
        ...Object.entries(conversation.courseRun.pageQa).flatMap(
          ([pageId, stage]) => [
            pageId,
            stage.status,
            stage.events.length,
          ],
        ),
      ].join(":")
    : "";

  useEffect(() => {
    const conversationChanged =
      previousConversationIdRef.current !== conversation?.id;
    const messagesChanged = previousMessageCountRef.current !== messageCount;
    const shouldFollow =
      conversationChanged || messagesChanged || nearBottomRef.current;

    previousConversationIdRef.current = conversation?.id;
    previousMessageCountRef.current = messageCount;

    if (!shouldFollow) return;

    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    });

    return () => cancelAnimationFrame(frame);
  }, [
    connectionStatus,
    conversation?.id,
    courseRunRevision,
    messageCount,
    taskStatus,
  ]);

  const scrollToLatest = () => {
    const container = scrollRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#fff9ee]">
      <div
        aria-label="对话内容"
        aria-live="polite"
        className="scrollbar-hide min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const container = event.currentTarget;
          const distance =
            container.scrollHeight - container.scrollTop - container.clientHeight;
          nearBottomRef.current = distance <= 80;
          setShowLatest(distance > 80);
        }}
        ref={scrollRef}
        role="log"
      >
        {conversation === null ? (
          <div className="flex min-h-full items-center justify-center px-6 pb-4 text-center">
            <div className="-translate-y-14 max-sm:-translate-y-4">
              <div className="keya-fade-up">
                <h1 className="m-0 text-[40px] leading-[40px] font-semibold text-[#2d332b] max-sm:max-w-[330px] max-sm:text-[30px] max-sm:leading-[38px]">
                  想学点什么？准备
                  <span className="relative inline-block text-[#397a52]">
                    变好
                    <Image
                      alt=""
                      aria-hidden="true"
                      className="absolute top-[42px] left-1/2 max-w-none -translate-x-1/2 max-sm:top-[38px]"
                      height={6}
                      src="/keya/images/title-deco.svg"
                      width={78}
                    />
                  </span>
                  了吗？
                </h1>
                <p className="mt-3 text-base leading-[22px] text-[#7a7468] [animation:keya-fade-up_200ms_ease-out_75ms_both]">
                  想学点新东西，但不知道怎么开始？
                </p>
              </div>
            </div>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-[#7a7468]">
            开始这段对话吧
          </div>
        ) : (
          <div className="mx-auto w-[calc(100%-48px)] max-w-[760px] space-y-7 pt-8 pb-12 max-sm:w-[calc(100%-32px)] max-sm:pt-16">
            {conversation.messages
              .filter(
                (message) =>
                  message.role === "user" ||
                  (!conversation.courseRun && !courseBrief),
              )
              .map((message) =>
              message.role === "user" ? (
                <div className="flex justify-end" key={message.id}>
                  <div className="max-w-[585px] rounded-[20px] rounded-tr-md bg-[var(--keya-user-bubble)] px-5 py-3.5 text-[14px] leading-6 whitespace-pre-wrap text-foreground">
                    {message.content}
                  </div>
                </div>
              ) : (
                <article className="text-foreground" key={message.id}>
                  <div className="text-[14.5px] leading-[25.81px] whitespace-pre-wrap">
                    {message.content}
                  </div>
                </article>
              ),
            )}
            {courseBrief &&
            !conversation.courseRun &&
            onAnswerCourseQuestion &&
            onConfirmCourse ? (
              <CourseCreationCards
                brief={courseBrief}
                busy={busy}
                onAnswer={onAnswerCourseQuestion}
                onConfirm={onConfirmCourse}
                question={courseQuestion}
              />
            ) : null}
            {conversation.courseRun ? (
              <CourseRunTimeline
                busy={busy}
                connectionStatus={connectionStatus}
                onOpenCoursePlayer={onOpenCoursePlayer}
                onResumeCourse={onResumeCourse}
                run={conversation.courseRun}
                taskStatus={taskStatus}
              />
            ) : null}
          </div>
        )}
      </div>

      {showLatest ? (
        <Button
          className="absolute bottom-4 left-1/2 z-10 flex min-h-[34px] -translate-x-1/2 items-center gap-2 rounded-full border border-[#e8dfd0] bg-[#fffcf5] py-px pr-[15px] pl-[13px] text-sm font-normal text-[#3f4a40] shadow-[0_8px_12px_rgba(45,51,43,0.16),0_2px_3px_rgba(45,51,43,0.08)] transition-colors hover:border-[#9a8e7c] hover:bg-[#fffcf5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
          onClick={scrollToLatest}
          type="button"
          variant="outline"
        >
          <ChevronDownIcon
            aria-hidden="true"
            size={16}
            strokeWidth={1.7}
          />
          回到最新
        </Button>
      ) : null}
    </div>
  );
}
