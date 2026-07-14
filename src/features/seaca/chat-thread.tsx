"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CourseRunTimeline } from "@/features/seaca/course-run-timeline";
import type { SeacaConversation } from "@/types/seaca";

interface ChatThreadProps {
  conversation: SeacaConversation | null;
}

export function ChatThread({ conversation }: ChatThreadProps) {
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
        ...Object.entries(conversation.courseRun.pageHtml).flatMap(
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
  }, [conversation?.id, courseRunRevision, messageCount]);

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
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#fcf9f2]">
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
              <div className="seaca-fade-up">
                <h1 className="m-0 text-[40px] leading-[40px] font-semibold text-[#382c19] max-sm:max-w-[330px] max-sm:text-[30px] max-sm:leading-[38px]">
                  想学点什么？准备
                  <span className="relative inline-block text-[#77cc57]">
                    变好
                    <Image
                      alt=""
                      aria-hidden="true"
                      className="absolute top-[42px] left-1/2 max-w-none -translate-x-1/2 max-sm:top-[38px]"
                      height={6}
                      src="/seaca/images/title-deco.svg"
                      width={78}
                    />
                  </span>
                  了吗？
                </h1>
                <p className="mt-3 text-base leading-[22px] text-[#988e80] [animation:seaca-fade-up_200ms_ease-out_75ms_both]">
                  想学点新东西，但不知道怎么开始？
                </p>
              </div>
            </div>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-[#988e80]">
            开始这段对话吧
          </div>
        ) : (
          <div className="mx-auto w-[calc(100%-48px)] max-w-[750px] space-y-7 pt-7 pb-12 max-sm:w-[calc(100%-32px)] max-sm:pt-16">
            {conversation.messages.map((message) =>
              message.role === "user" ? (
                <div className="flex justify-end" key={message.id}>
                  <div className="max-w-[585px] rounded-2xl rounded-tr-md bg-[#f5f1ea] px-4 py-3 text-[14px] leading-6 whitespace-pre-wrap text-[#382c19]">
                    {message.content}
                  </div>
                </div>
              ) : (
                <article className="text-[#382c19]" key={message.id}>
                  {message.duration ? (
                    <div className="mb-2 flex items-center gap-2 text-sm leading-5 text-[#988e80]">
                      <CheckIcon
                        aria-hidden="true"
                        className="text-[#77cc57]"
                        size={15}
                        strokeWidth={1.7}
                      />
                      <span>已完成 {message.duration}</span>
                    </div>
                  ) : null}
                  <div className="text-[14.5px] leading-[25.81px] whitespace-pre-wrap">
                    {message.content}
                  </div>
                </article>
              ),
            )}
            {conversation.courseRun ? (
              <CourseRunTimeline run={conversation.courseRun} />
            ) : null}
          </div>
        )}
      </div>

      {showLatest ? (
        <Button
          className="absolute bottom-4 left-1/2 z-10 flex min-h-[34px] -translate-x-1/2 items-center gap-2 rounded-full border border-[#ebe1d6] bg-[#fffdf7] py-px pr-[15px] pl-[13px] text-sm font-normal text-[#5b4c3b] shadow-[0_8px_12px_rgba(56,44,25,0.16),0_2px_3px_rgba(56,44,25,0.08)] transition-colors hover:border-[#ad9688] hover:bg-[#fffdf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
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
