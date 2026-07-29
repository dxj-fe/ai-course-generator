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
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_80%_10%,rgba(166,218,162,0.2),transparent_24rem),linear-gradient(180deg,rgba(248,252,244,0.82)_0%,rgba(237,248,234,0.7)_100%)]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-[12%] -left-20 size-56 rounded-full bg-[#bfe7ae]/20 blur-3xl motion-safe:animate-pulse"
      />
      <span
        aria-hidden="true"
        className="keya-gentle-bob pointer-events-none absolute top-[18%] right-[7%] h-16 w-9 rotate-[30deg] rounded-[90%_10%_90%_10%] bg-[#7bc873]/16"
      />
      <div
        aria-label="对话内容"
        aria-live="polite"
        className="scrollbar-hide relative z-[1] min-h-0 flex-1 overflow-y-auto"
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
            <div className="keya-page-reveal -translate-y-10 max-sm:-translate-y-2">
              <div className="relative mx-auto mb-1 flex h-[170px] w-[210px] items-center justify-center max-sm:h-[138px] max-sm:w-[170px]">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 bottom-5 h-12 rounded-[50%] bg-[#74c67a]/20 blur-xl"
                />
                <span
                  aria-hidden="true"
                  className="absolute top-8 left-2 size-2 rotate-45 rounded-[3px] bg-[#f2b84b] motion-safe:animate-pulse"
                />
                <span
                  aria-hidden="true"
                  className="absolute top-16 right-1 size-3 rotate-45 rounded-[3px] bg-[#f2b84b]/85 motion-safe:animate-pulse [animation-delay:900ms]"
                />
                <Image
                  alt=""
                  aria-hidden="true"
                  className="keya-gentle-bob relative h-[190px] w-auto object-contain drop-shadow-[0_18px_22px_rgba(47,104,69,0.16)] max-sm:h-[154px]"
                  height={285}
                  priority
                  src="/keya/images/keya-sprout-companion.png"
                  width={190}
                />
              </div>
              <div className="rounded-[30px] border border-white/70 bg-white/38 px-8 py-6 shadow-[0_24px_60px_-46px_rgba(35,82,49,0.6)] backdrop-blur-sm max-sm:px-4 max-sm:py-5">
                <h1 className="m-0 text-[40px] leading-[40px] font-semibold text-[#284d34] max-sm:max-w-[330px] max-sm:text-[30px] max-sm:leading-[38px]">
                  想学点什么？准备
                  <span className="relative inline-block text-[#58a765]">
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
                <p className="mt-3 text-base leading-[22px] text-[#667568] [animation:keya-fade-up_200ms_ease-out_75ms_both]">
                  想学点新东西，但不知道怎么开始？
                </p>
              </div>
            </div>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-[#687969]">
            <span className="rounded-full border border-[#cfe2ca] bg-white/70 px-5 py-2.5 shadow-[0_12px_28px_-22px_rgba(47,104,69,0.6)]">
              开始这段对话吧
            </span>
          </div>
        ) : (
          <div className="keya-page-reveal mx-auto w-[calc(100%-48px)] max-w-[760px] space-y-7 pt-8 pb-12 max-sm:w-[calc(100%-32px)] max-sm:pt-16">
            {conversation.messages
              .filter(
                (message) =>
                  message.role === "user" ||
                  (!conversation.courseRun && !courseBrief),
              )
              .map((message) =>
              message.role === "user" ? (
                <div className="flex justify-end" key={message.id}>
                  <div className="max-w-[585px] rounded-[22px] rounded-tr-md border border-[#c8dfc4] bg-[#dff1d9]/88 px-5 py-3.5 text-[14px] leading-6 whitespace-pre-wrap text-[#294d34] shadow-[0_12px_28px_-24px_rgba(47,104,69,0.72)]">
                    {message.content}
                  </div>
                </div>
              ) : (
                <article
                  className="rounded-[24px] border border-white/75 bg-white/68 px-5 py-4 text-foreground shadow-[0_16px_36px_-32px_rgba(35,82,49,0.62)] backdrop-blur-sm"
                  key={message.id}
                >
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
          className="keya-latest-button absolute bottom-4 left-1/2 z-10 flex min-h-[34px] -translate-x-1/2 items-center gap-2 rounded-full border border-[#bcd6b8] bg-white/90 py-px pr-[15px] pl-[13px] text-sm font-normal text-[#31533a] shadow-[0_12px_28px_-16px_rgba(47,104,69,0.65)] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-[#83b182] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
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
