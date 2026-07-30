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
  ArrowUp as ArrowUpIcon,
  BookOpen,
  Languages,
  Lightbulb,
  Mic as MicIcon,
  Plus as PlusIcon,
  MessageCircleMore,
  Sprout,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
    <section className="keya-home-hero relative isolate w-full overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="keya-home-orb absolute -left-24 top-20 size-72 rounded-full bg-[#bfe7ae]/55 blur-3xl" />
        <span className="keya-home-orb keya-home-orb-delayed absolute -right-24 top-8 size-80 rounded-full bg-[#f6d67d]/35 blur-3xl" />
        <span className="keya-home-sparkle absolute left-[9%] top-[24%] size-2 rounded-full bg-[#f2b84b]" />
        <span className="keya-home-sparkle keya-home-sparkle-delayed absolute right-[10%] top-[15%] size-3 rotate-45 rounded-[3px] bg-[#f2b84b]" />
        <span className="keya-home-leaf absolute left-[5%] top-[54%] h-12 w-7 -rotate-[28deg] rounded-[90%_10%_90%_10%] bg-[#86c96f]/45" />
        <span className="keya-home-leaf keya-home-leaf-delayed absolute right-[4%] top-[48%] h-16 w-9 rotate-[32deg] rounded-[90%_10%_90%_10%] bg-[#65b96d]/35" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1248px] px-6 pb-12 pt-10 sm:pt-14 lg:pb-0 lg:pt-6">
        <div className="grid items-center gap-4 lg:min-h-[430px] lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.72fr)] lg:gap-10">
          <div className="keya-home-reveal relative z-10 mx-auto w-full max-w-[690px] text-center lg:mx-0 lg:text-left">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#cfe5c7] bg-white/70 px-4 py-2 text-sm font-medium text-[#397a52] shadow-[0_8px_24px_-18px_rgba(47,104,69,0.45)] lg:mx-0">
              <Sprout aria-hidden="true" className="size-4" strokeWidth={2} />
              让每一个好奇，都长成一门好课
            </p>

            <h1 className="mt-5 text-[40px] font-semibold leading-[1.12] tracking-[-0.045em] text-[#203c2a] sm:text-5xl lg:text-[64px]">
              Hi，今天想
              <span className="block sm:inline">
                <span className="relative mx-1 inline-block text-[#397a52]">
                  解锁
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="absolute left-1/2 top-[calc(100%+3px)] w-[88%] max-w-none -translate-x-1/2"
                    height={6}
                    src="/keya/images/title-deco.svg"
                    width={78}
                  />
                </span>
                什么？
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-[520px] text-[15px] leading-7 text-[#617263] sm:text-base lg:mx-0">
              告诉课芽你的想法，我们随时开始
            </p>

            <div className="mt-7 flex w-full items-stretch gap-2.5">
              <Link
                aria-label="进入聊天"
                className="group flex size-14 shrink-0 items-center justify-center self-stretch rounded-[20px] border border-[#d5e7d0] bg-white/85 text-[#397a52] shadow-[0_14px_32px_-22px_rgba(47,104,69,0.55)] transition duration-300 hover:-translate-y-1 hover:rotate-[-3deg] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none sm:size-16 sm:rounded-[24px]"
                href="/chat"
              >
                <MessageCircleMore
                  aria-hidden="true"
                  className="size-7 transition-transform duration-300 group-hover:scale-110 motion-reduce:scale-100 sm:size-8"
                  strokeWidth={1.8}
                />
              </Link>

              <form
                className="keya-home-composer flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-[20px] border border-[#cfe2ca] bg-white/90 px-3 py-2 shadow-[0_20px_55px_-28px_rgba(47,104,69,0.48)] backdrop-blur transition duration-300 focus-within:border-[#74aa70] focus-within:bg-white focus-within:shadow-[0_22px_58px_-25px_rgba(47,104,69,0.58),0_0_0_5px_rgba(116,170,112,0.12)] sm:min-h-16 sm:gap-3 sm:rounded-[24px] sm:px-4"
                onSubmit={handleSubmit}
              >
                <Input
                  className="hidden"
                  ref={fileInputRef}
                  tabIndex={-1}
                  type="file"
                />
                <Button
                  aria-label="添加内容"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#718172] transition duration-200 hover:rotate-90 hover:bg-[#eaf5e5] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
                  onClick={() => fileInputRef.current?.click()}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <PlusIcon
                    aria-hidden="true"
                    className="size-5"
                    strokeWidth={1.8}
                  />
                </Button>
                <Textarea
                  aria-label="消息输入"
                  className="max-h-[120px] min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 text-[14px] leading-6 text-[#203c2a] outline-none [field-sizing:fixed] placeholder:text-[#819083] focus-visible:border-0 focus-visible:ring-0"
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
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#718172] transition duration-200 hover:scale-105 hover:bg-[#eaf5e5] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none max-[359px]:hidden"
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <MicIcon
                      aria-hidden="true"
                      className="size-5"
                      strokeWidth={1.8}
                    />
                  </Button>
                  <Button
                    aria-label="发送"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white shadow-sm transition duration-200 enabled:bg-[#397a52] enabled:hover:-translate-y-0.5 enabled:hover:bg-[#2f6845] enabled:hover:shadow-[0_8px_18px_-8px_rgba(47,104,69,0.75)] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#397a52] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[#d8e2d6] disabled:text-[#879486] disabled:opacity-100 motion-reduce:transform-none"
                    disabled={!canSubmit}
                    size="icon"
                    type="submit"
                    variant="ghost"
                  >
                    <ArrowUpIcon
                      aria-hidden="true"
                      className="size-[19px]"
                      strokeWidth={1.8}
                    />
                  </Button>
                </div>
              </form>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {promptChips.map(({ Icon, text }) => (
                <Button
                  className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/80 bg-[#e8f4e3]/85 px-2.5 text-[12px] leading-5 font-normal text-[#3f6349] shadow-[0_9px_24px_-20px_rgba(47,104,69,0.5)] transition duration-200 hover:-translate-y-0.5 hover:border-[#c7dfc1] hover:bg-white hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none min-[370px]:text-[13px] sm:px-3.5"
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
                    className="size-3.5 shrink-0 text-[#5e9b65]"
                    strokeWidth={1.8}
                  />
                  {text}
                </Button>
              ))}
            </div>
          </div>

          <div
            aria-hidden="true"
            className="keya-home-art relative mx-auto h-[290px] w-full max-w-[360px] lg:h-[430px] lg:max-w-[440px]"
          >
            <span className="absolute left-1/2 top-1/2 h-[78%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-[48%] bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.95),rgba(213,238,202,0.7)_48%,rgba(190,226,170,0)_72%)]" />
            <span className="keya-home-sparkle absolute left-[8%] top-[24%] size-3 rotate-45 rounded-[3px] bg-[#f2b84b]" />
            <span className="keya-home-sparkle keya-home-sparkle-delayed absolute right-[4%] top-[57%] size-2.5 rotate-45 rounded-[3px] bg-[#f2b84b]" />
            <span className="keya-home-leaf absolute bottom-[15%] left-[3%] h-16 w-9 -rotate-[42deg] rounded-[90%_10%_90%_10%] bg-[#7bc873]/50" />
            <span className="keya-home-leaf keya-home-leaf-delayed absolute right-[2%] top-[15%] h-14 w-8 rotate-[38deg] rounded-[90%_10%_90%_10%] bg-[#9cd77f]/50" />
            <div className="keya-home-sprout-enter absolute inset-0">
              <div className="keya-home-sprout-bob absolute inset-0">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 h-auto w-[82%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_24px_28px_rgba(47,104,69,0.18)] lg:w-[96%]"
                  height={1536}
                  priority
                  sizes="(min-width: 1024px) 440px, 360px"
                  src="/keya/images/keya-sprout-companion.png"
                  width={1024}
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
