"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight as ArrowRightIcon,
  ArrowUp as ArrowUpIcon,
  BookOpen,
  Languages,
  Lightbulb,
  Mic as MicIcon,
  Plus as PlusIcon,
  MessageCircleMore,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CourseHistoryItem } from "@/shared/course-schema";

const promptChips = [
  {
    Icon: BookOpen,
    text: "帮我补上高一数学",
  },
  {
    Icon: Lightbulb,
    text: "30 分钟读懂《论语》",
  },
  {
    Icon: Languages,
    text: "练一段地道英文对话",
  },
  {
    Icon: Sparkles,
    text: "给我一个学习计划",
  },
] as const;

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "24px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
}

export function HomeHero({
  featuredWorks,
}: {
  featuredWorks: CourseHistoryItem[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = draft.trim().length > 0;

  useEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [draft]);

  const goToChat = (prompt: string) => {
    router.push(`/chat?prompt=${encodeURIComponent(prompt)}`);
  };

  const submitDraft = () => {
    const value = draft.trim();
    if (value) goToChat(value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submitDraft();
    }
  };

  return (
    <section className="relative h-[732px] w-full overflow-hidden bg-[#fff9ee]">
      <div className="absolute left-1/2 top-[72px] z-10 w-[729.438px] -translate-x-1/2 text-center">
        <h1 className="m-0 whitespace-nowrap text-[40px] font-semibold leading-[40px] text-[#2d332b]">
          Hi，今天想
          <span className="relative inline-block text-[#397a52]">
            解锁
            <Image
              alt=""
              aria-hidden="true"
              className="absolute left-1/2 top-[42px] max-w-none -translate-x-1/2"
              height={6}
              src="/keya/images/title-deco.svg"
              width={78}
            />
          </span>
          什么？
        </h1>
      </div>
      <p className="absolute left-1/2 top-[140px] z-10 m-0 -translate-x-1/2 whitespace-nowrap text-center text-[16px] leading-6 text-[#7a7468]">
        告诉课芽你的想法，我们随时开始
      </p>

      <div className="absolute left-1/2 top-[217px] z-10 grid h-[216px] w-[calc(100%-48px)] max-w-[1200px] -translate-x-1/2 grid-cols-3 gap-6 sm:top-[260.25px]">
        {featuredWorks.length === 0 ? (
          <Link
            className="col-span-3 flex h-[216px] items-center justify-center rounded-xl border border-dashed border-[#d9cfc2] bg-[#fffcf5]/80 text-center text-[#76685b] hover:border-[#397a52]"
            href="/chat"
          >
            <span>
              <strong className="block text-lg text-[#2d332b]">
                还没有真实课程作品
              </strong>
              <span className="mt-2 block text-sm">
                从一次对话开始，生成结果会自动保存到数据库
              </span>
            </span>
          </Link>
        ) : featuredWorks.map((work, index) => (
          <Button
            aria-label={`进入${work.title}`}
            className="group relative h-[216px] min-w-0 overflow-hidden rounded-xl border-0 bg-[linear-gradient(135deg,#eaf3e7,#fff0c9_55%,#f3e7ce)] p-6 text-left font-normal whitespace-normal hover:brightness-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
            key={work.courseId}
            onClick={() => router.push(`/course/${work.courseId}`)}
            title={work.title}
            type="button"
            variant="ghost"
          >
            <span className="absolute -right-10 -top-12 size-36 rounded-full border-[22px] border-white/30" />
            <span className="relative block text-xs font-semibold tracking-[0.18em] text-[#397a52]">
              COURSE {String(index + 1).padStart(2, "0")}
            </span>
            <strong className="relative mt-7 line-clamp-2 block max-w-[82%] text-xl leading-7 text-[#2d332b]">
              {work.title}
            </strong>
            <span className="relative mt-3 block text-xs text-[#7a7468]">
              {work.completedPages}/{work.totalPages} 页 ·{" "}
              {work.status === "completed" ? "已完成" : "最近更新"}
            </span>
            <span
              aria-hidden="true"
              className="absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full border-4 border-[#fff9ee] bg-[#397a52] text-white transition-transform duration-150 group-hover:scale-105"
            >
              <ArrowRightIcon
                aria-hidden="true"
                className="size-[22px]"
                size={22}
                strokeWidth={1.7}
              />
            </span>
          </Button>
        ))}
      </div>

      <div className="absolute left-1/2 top-[500px] z-10 grid w-[342px] max-w-[calc(100%-48px)] -translate-x-1/2 grid-cols-2 gap-2 sm:top-[582.5px] sm:flex sm:w-auto sm:max-w-none sm:flex-nowrap">
        {promptChips.map(({ Icon, text }) => (
          <Button
            className="flex h-[33.5px] items-center justify-self-center gap-0 whitespace-nowrap rounded-full border-0 bg-[rgba(253,250,247,0.7)] pl-2.5 pr-3 text-[14px] leading-6 font-normal shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] transition-colors duration-150 hover:bg-[rgba(253,251,248,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] sm:gap-2 sm:pl-3.5 sm:pr-4 sm:text-[16px]"
            key={text}
            onClick={() => {
              setDraft(text);
              textareaRef.current?.focus();
            }}
            type="button"
            variant="ghost"
          >
            <Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-[#397a52]"
              size={14}
              strokeWidth={1.7}
            />
            {text}
          </Button>
        ))}
      </div>

      <div className="absolute left-1/2 top-[628px] z-10 h-14 w-[calc(100%-48px)] max-w-[886px] -translate-x-1/2">
        <Link
          aria-label="进入聊天"
          className="group absolute right-[calc(100%+10px)] top-0 flex size-14 items-center justify-center rounded-full bg-[#fff9ee] shadow-[0_1.5px_1.7px_rgba(224,210,196,0.9),0_4px_13px_rgba(232,214,194,0.72)] transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] sm:left-0 sm:right-auto"
          href="/chat"
        >
          <MessageCircleMore
            aria-hidden="true"
            className="size-[38px] text-[#dbc5ad]"
            size={38}
            strokeWidth={1.7}
          />
        </Link>

        <form
          className="ml-0 flex min-h-14 w-full max-w-[738px] items-center gap-3 rounded-full border border-[rgba(232,223,208,0.5)] bg-[#fff9ee] py-[11px] pl-5 shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] sm:ml-[66px] sm:w-[738px]"
          onSubmit={handleSubmit}
        >
          <Input className="hidden" ref={fileInputRef} tabIndex={-1} type="file" />
          <Button
            aria-label="添加内容"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#7a7468] transition duration-150 hover:scale-[1.08] hover:bg-transparent hover:text-[#2d332b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
            onClick={() => fileInputRef.current?.click()}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <PlusIcon
              aria-hidden="true"
              className="size-6"
              size={24}
              strokeWidth={1.7}
            />
          </Button>
          <Textarea
            aria-label="消息输入"
            className="max-h-[120px] min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-1 text-[14px] leading-6 text-[#2d332b] outline-none [field-sizing:fixed] placeholder:text-[#7a7468] focus-visible:border-0 focus-visible:ring-0"
            onChange={(event) => {
              resizeTextarea(event.currentTarget);
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="想学点什么？慢慢找也可以..."
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="语音输入"
              className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#7a7468] transition duration-150 hover:scale-[1.06] hover:bg-[rgba(57,122,82,0.14)] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] max-[350px]:hidden"
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <MicIcon
                aria-hidden="true"
                className="size-[22px]"
                size={22}
                strokeWidth={1.7}
              />
            </Button>
            <Button
              aria-label="发送"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white transition-colors duration-150 enabled:bg-[#397a52] enabled:hover:bg-[#2f6845] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#397a52] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[rgba(91,76,59,0.18)] disabled:opacity-100 disabled:hover:bg-[rgba(91,76,59,0.18)]"
              disabled={!canSubmit}
              size="icon"
              type="submit"
              variant="ghost"
            >
              <ArrowUpIcon
                aria-hidden="true"
                className="size-[19px]"
                size={19}
                strokeWidth={1.7}
              />
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
