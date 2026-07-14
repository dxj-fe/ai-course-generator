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
import { featuredWorks } from "@/data/seaca";

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

function EnglishLearningCover() {
  return (
    <div className="absolute inset-y-0 left-0 w-96 overflow-hidden bg-[#f2f1ff] text-left text-[#17151b]">
      <div className="absolute left-5 top-6 text-[8px] font-semibold tracking-[0.08em] text-[#4f46b7]">
        零基础入门 · 日常对话
      </div>
      <div className="absolute left-5 top-[50px] text-[23px] font-bold leading-[25px] tracking-[-0.03em]">
        <div>开口说英语</div>
        <div className="mt-0.5 flex items-center">
          从
          <span className="mx-1 bg-[#ffe34f] px-0.5">4 个场景</span>
          开始
        </div>
      </div>
      <p className="absolute left-5 top-[109px] m-0 w-[172px] text-[8px] leading-[13px] text-[#665f70]">
        覆盖问候、点餐、购物、问路
        <br />
        标准发音示范，常用句型，实战练习
      </p>
      <div className="absolute left-5 top-[145px] flex gap-2 text-[7px] font-semibold">
        <span className="rounded-full bg-[#fff2a4] px-2 py-1">问候</span>
        <span className="rounded-full bg-[#dff5d5] px-2 py-1">点餐</span>
        <span className="rounded-full bg-[#ffdce8] px-2 py-1">购物</span>
        <span className="rounded-full bg-[#dcecff] px-2 py-1">问路</span>
      </div>
      <div className="absolute bottom-7 left-5 rounded bg-[#6555ee] px-3 py-2 text-[7px] font-semibold text-white">
        学会高频表达，轻松完成 4 种场景对话
      </div>

      <div className="absolute left-[245px] top-[48px] size-12 rounded-full bg-[#f3c99d]">
        <span className="absolute left-3 top-[21px] h-1 w-1 rounded-full bg-[#382c19]" />
        <span className="absolute right-3 top-[21px] h-1 w-1 rounded-full bg-[#382c19]" />
        <span className="absolute left-[17px] top-[31px] h-1.5 w-3 rounded-b-full border-b-2 border-[#382c19]" />
      </div>
      <div className="absolute left-[235px] top-[88px] h-[92px] w-[77px] rounded-b-[38px] rounded-t-[24px] bg-[#5648ee]" />
      <div className="absolute left-[254px] top-[37px] h-5 w-11 rounded-t-full bg-[#3d2a21]" />
      <div className="absolute left-[320px] top-[61px] rounded-lg bg-[#fff8d9] px-2 py-1 text-[7px] text-[#5b4c3b] shadow-sm">
        Hello!
        <br />
        Nice to meet you
      </div>
      <span className="absolute left-[228px] top-[55px] size-2 rotate-45 bg-[#77cc57]" />
      <span className="absolute left-[337px] top-[35px] size-2 rounded-full bg-[#ffe34f]" />
      <span className="absolute left-[329px] top-[133px] size-2 rounded-full bg-[#ef7aac]" />
    </div>
  );
}

export function HomeHero() {
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
    <section className="relative h-[732px] w-full overflow-hidden bg-[#fdfbf8]">
      <Image
        alt=""
        aria-hidden="true"
        className="object-cover"
        fill
        priority
        sizes="100vw"
        src="/seaca/images/bg.png"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(#fdfbf8 0%, rgba(253,251,248,0) 46.154%, #fdfbf8 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] mix-blend-multiply"
        style={{ backgroundImage: "url('/seaca/images/dots.png')" }}
      />

      <div className="absolute left-1/2 top-[72px] z-10 w-[729.438px] -translate-x-1/2 text-center">
        <h1 className="m-0 whitespace-nowrap text-[40px] font-semibold leading-[40px] text-[#382c19]">
          Hi seaca_d931d5e4, 今天想
          <span className="relative inline-block text-[#77cc57]">
            解锁
            <Image
              alt=""
              aria-hidden="true"
              className="absolute left-1/2 top-[42px] max-w-none -translate-x-1/2"
              height={6}
              src="/seaca/images/title-deco.svg"
              width={78}
            />
          </span>
          什么？
        </h1>
      </div>
      <p className="absolute left-1/2 top-[140px] z-10 m-0 -translate-x-1/2 whitespace-nowrap text-center text-[16px] leading-6 text-[#988e80]">
        告诉我们的想法，我们随时开始
      </p>

      <div className="absolute left-1/2 top-[217px] z-10 grid h-[216px] w-[calc(100%-48px)] max-w-[1200px] -translate-x-1/2 grid-cols-3 gap-6 sm:top-[260.25px]">
        {featuredWorks.map((work) => (
          <Button
            aria-label={`进入${work.title}`}
            className="group relative h-[216px] min-w-0 overflow-hidden rounded-xl border-0 bg-[#f2f1ff] p-0 text-left font-normal whitespace-normal hover:bg-[#f2f1ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
            key={work.id}
            onClick={() => goToChat(work.title)}
            title={work.title}
            type="button"
            variant="ghost"
          >
            {work.image ? (
              <Image
                alt={work.title}
                className="object-cover"
                fill
                priority
                sizes="(min-width: 640px) 384px, 98px"
                src={work.image}
                unoptimized
              />
            ) : (
              <EnglishLearningCover />
            )}
            <span
              aria-hidden="true"
              className="absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full border-4 border-[#fdfbf8] bg-[rgba(91,76,59,0.9)] text-white transition-transform duration-150 group-hover:scale-105"
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
            className="flex h-[33.5px] items-center justify-self-center gap-0 whitespace-nowrap rounded-full border-0 bg-[rgba(253,250,247,0.7)] pl-2.5 pr-3 text-[14px] leading-6 font-normal shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] transition-colors duration-150 hover:bg-[rgba(253,251,248,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57] sm:gap-2 sm:pl-3.5 sm:pr-4 sm:text-[16px]"
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
              className="size-3.5 shrink-0 text-[#77cc57]"
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
          className="group absolute right-[calc(100%+10px)] top-0 flex size-14 items-center justify-center rounded-full bg-[#fdfbf8] shadow-[0_1.5px_1.7px_rgba(224,210,196,0.9),0_4px_13px_rgba(232,214,194,0.72)] transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57] sm:left-0 sm:right-auto"
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
          className="ml-0 flex min-h-14 w-full max-w-[738px] items-center gap-3 rounded-full border border-[rgba(235,225,214,0.5)] bg-[#fdfbf8] py-[11px] pl-5 shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] sm:ml-[66px] sm:w-[738px]"
          onSubmit={handleSubmit}
        >
          <Input className="hidden" ref={fileInputRef} tabIndex={-1} type="file" />
          <Button
            aria-label="添加内容"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#988e80] transition duration-150 hover:scale-[1.08] hover:bg-transparent hover:text-[#382c19] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
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
            className="max-h-[120px] min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-1 text-[14px] leading-6 text-[#382c19] outline-none [field-sizing:fixed] placeholder:text-[#988e80] focus-visible:border-0 focus-visible:ring-0"
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
              className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#988e80] transition duration-150 hover:scale-[1.06] hover:bg-[rgba(119,204,87,0.14)] hover:text-[#5ba83e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57] max-[350px]:hidden"
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
              className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white transition-colors duration-150 enabled:bg-[#77cc57] enabled:hover:bg-[#5ba83e] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#77cc57] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[rgba(91,76,59,0.18)] disabled:opacity-100 disabled:hover:bg-[rgba(91,76,59,0.18)]"
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
