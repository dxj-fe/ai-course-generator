"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";
import {
  ArrowUp as ArrowUpIcon,
  BookOpen,
  ChevronDown,
  CircleCheck,
  Languages,
  Lightbulb,
  LoaderCircle,
  Mic as MicIcon,
  Pause,
  Play,
  Plus as PlusIcon,
  Presentation,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  attachments?: ReferenceAttachment[];
  draft: string;
  busy?: boolean;
  compact?: boolean;
  contextLabel?: string;
  onDraftChange(value: string): void;
  onFilesSelected?(files: File[]): void;
  onPause?(): void;
  onRemoveAttachment?(id: string): void;
  onResume?(): void;
  onRetryAttachment?(id: string): void;
  onSubmit(value: string): void;
  onSelectSuggestion?(value: string): void;
  showSuggestions: boolean;
  taskStatus?: "paused" | "queued" | "running";
}

export type ReferenceAttachment = {
  id: string;
  name: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  summary?: string;
  keyFacts?: string[];
};

const suggestions = [
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

export function ChatComposer({
  attachments = [],
  draft,
  busy = false,
  compact = false,
  contextLabel,
  onDraftChange,
  onFilesSelected,
  onPause,
  onRemoveAttachment,
  onResume,
  onRetryAttachment,
  onSelectSuggestion,
  onSubmit,
  showSuggestions,
  taskStatus,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsBlocked = attachments.some(({ status }) => status !== "ready");
  const hasReadyAttachments = attachments.some(({ status }) => status === "ready");
  const hasAttachmentError = attachments.some(({ status }) => status === "error");
  const canSubmit = draft.trim().length > 0 && !busy && !attachmentsBlocked;
  const taskRunning = taskStatus === "queued" || taskStatus === "running";
  const taskPaused = taskStatus === "paused";
  const placeholder = hasAttachmentError
    ? "请先重试或移除解析失败的资料..."
    : attachmentsBlocked
      ? "可以先描述任务，资料解析完成后即可发送..."
      : hasReadyAttachments
        ? "描述要基于资料生成的课程，例如：生成一门系统的太阳风入门课..."
        : contextLabel
          ? "补充要求，或者告诉课芽怎么调整..."
          : "想学点什么？慢慢找也可以...";

  useEffect(() => {
    if (textareaRef.current) {
      resizeTextarea(textareaRef.current);
    }
  }, [draft]);

  const submitDraft = () => {
    const value = draft.trim();
    if (value && !busy && !attachmentsBlocked) {
      onSubmit(value);
    }
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

  const handleSuggestion = (value: string) => {
    if (onSelectSuggestion) {
      onSelectSuggestion(value);
      return;
    }

    onDraftChange(value);
  };

  return (
    <div className="relative z-[2] w-full shrink-0 bg-[linear-gradient(180deg,rgba(237,248,234,0)_0%,rgba(237,248,234,0.88)_42%,rgba(237,248,234,0.98)_100%)] px-6 pt-2 pb-[calc(22px+env(safe-area-inset-bottom))] max-sm:px-4 max-sm:pb-[calc(16px+env(safe-area-inset-bottom))]">
      <form
        className="relative mx-auto w-full max-w-[750px]"
        onSubmit={handleSubmit}
      >
        {attachments.length > 0 ? (
          <ul
            aria-label="已选参考资料"
            aria-live="polite"
            className="mb-2 grid gap-2"
          >
            {attachments.map((attachment) => (
              <li
                className="keya-page-reveal min-w-0 rounded-[20px] border border-[#cfe2ca] bg-white/86 px-3 py-2.5 text-xs text-[#607061] shadow-[0_14px_30px_-24px_rgba(47,104,69,0.55)] backdrop-blur"
                key={attachment.id}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {attachment.status === "uploading" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 shrink-0 animate-spin text-[#4f8f65]"
                    />
                  ) : attachment.status === "error" ? (
                    <TriangleAlert
                      aria-hidden="true"
                      className="size-4 shrink-0 text-[#b65e49]"
                    />
                  ) : (
                    <CircleCheck
                      aria-hidden="true"
                      className="size-4 shrink-0 text-[#4f8f65]"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-[#3f4a40]">
                    {attachment.name}
                  </span>
                  <Badge
                    className={`h-auto shrink-0 overflow-visible rounded-full border-0 px-2 py-0.5 text-[10px] leading-normal ${
                      attachment.status === "error"
                        ? "bg-[#fff0ec] text-[#a54f3d]"
                        : attachment.status === "uploading"
                          ? "bg-[#f5f0df] text-[#766438]"
                          : "bg-[#e3f2de] text-[#397a52]"
                    }`}
                  >
                    {attachment.status === "uploading"
                      ? "正在解析"
                      : attachment.status === "error"
                        ? "解析失败"
                        : "解析完成"}
                  </Badge>
                  {attachment.status === "error" && onRetryAttachment ? (
                    <Button
                      aria-label={`重试解析 ${attachment.name}`}
                      className="size-7 rounded-full text-[#718072] hover:bg-[#edf8ea] hover:text-[#2f6845]"
                      disabled={busy}
                      onClick={() => onRetryAttachment(attachment.id)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw aria-hidden="true" className="size-3.5" />
                    </Button>
                  ) : null}
                  {onRemoveAttachment ? (
                    <Button
                      aria-label={`移除资料 ${attachment.name}`}
                      className="size-7 rounded-full text-[#718072] hover:bg-[#edf8ea] hover:text-[#2f6845]"
                      disabled={busy}
                      onClick={() => onRemoveAttachment(attachment.id)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  ) : null}
                </div>

                {attachment.status === "uploading" ? (
                  <p className="mt-2 pl-6 leading-5 text-[#708071]">
                    正在提取正文并生成可引用摘要…
                  </p>
                ) : attachment.status === "error" ? (
                  <p className="mt-2 pl-6 leading-5 text-[#a54f3d]">
                    {attachment.error ?? "资料解析失败，请重试或移除。"}
                  </p>
                ) : (
                  <div className="mt-2 pl-6">
                    {attachment.summary ? (
                      <p className="line-clamp-2 leading-5 text-[#708071]">
                        {attachment.summary}
                      </p>
                    ) : null}
                    {attachment.keyFacts?.length ? (
                      <details className="group mt-1.5">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-[#4f8f65] outline-none hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] [&::-webkit-details-marker]:hidden">
                          查看关键事实（{attachment.keyFacts.length}）
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 transition-transform group-open:rotate-180"
                          />
                        </summary>
                        <ul className="mt-2 grid gap-1 border-l border-[#cfe2ca] pl-3 leading-5 text-[#708071]">
                          {attachment.keyFacts.slice(0, 4).map((fact) => (
                            <li key={fact}>• {fact}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <p className="mt-2 flex items-center gap-1.5 font-medium leading-5 text-[#397a52]">
                      <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
                      资料已解析，请在下方填写学习目标并发送
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {showSuggestions ? (
          <div
            className={`mb-3 flex flex-wrap justify-center gap-2 ${
              compact
                ? ""
                : "xl:relative xl:left-1/2 xl:w-max xl:-translate-x-1/2 xl:flex-nowrap"
            }`}
          >
            {suggestions.map(({ Icon, text }) => (
              <Button
                className="keya-card-lift group flex h-[35px] items-center gap-1.5 rounded-full border border-white/80 bg-white/68 py-0 pr-4 pl-3.5 text-[15px] leading-6 font-normal whitespace-nowrap text-[#3f6349] shadow-[0_10px_26px_-20px_rgba(47,104,69,0.55)] backdrop-blur hover:border-[#c7dfc1] hover:bg-white hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
                key={text}
                onClick={() => handleSuggestion(text)}
                type="button"
                variant="ghost"
              >
                <Icon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-[#58a765] transition-transform duration-200 group-hover:rotate-[-8deg] group-hover:scale-110 motion-reduce:transform-none"
                  size={14}
                  strokeWidth={1.7}
                />
                {text}
              </Button>
            ))}
          </div>
        ) : null}

        <div
          aria-busy={busy}
          className="flex min-h-[62px] items-center gap-2 rounded-[31px] border border-[#bdd8b9] bg-white/88 px-3 py-[11px] shadow-[0_20px_48px_-28px_rgba(47,104,69,0.58),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl transition duration-300 focus-within:-translate-y-0.5 focus-within:border-[#78a875] focus-within:bg-white focus-within:shadow-[0_24px_52px_-26px_rgba(47,104,69,0.7),0_0_0_5px_rgba(116,170,112,0.12)] motion-reduce:transform-none"
        >
          <Button
            aria-label="上传文件"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#6f806f] transition duration-200 hover:rotate-90 hover:scale-[1.08] hover:bg-[#edf8ea] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
            disabled={busy || attachments.length >= 3 || !onFilesSelected}
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
          <input
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            className="sr-only"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) onFilesSelected?.(files);
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />

          {contextLabel ? (
            <Badge
              className="flex h-auto shrink-0 items-center gap-1 overflow-visible rounded-full border border-[#cfe2ca] bg-[#e3f2de] px-2 py-1 text-xs font-medium text-[#2f6845]"
              variant="secondary"
            >
              <Presentation
                aria-hidden="true"
                className="size-[15px]! shrink-0 text-[#f0ae36]"
                size={15}
                strokeWidth={1.7}
              />
              {contextLabel}
            </Badge>
          ) : null}

          <Textarea
            aria-label="消息输入"
            className="min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-1 text-sm leading-6 text-[#294d34] outline-none [field-sizing:fixed] placeholder:text-[#778778] focus-visible:border-0 focus-visible:ring-0"
            onChange={(event) => {
              resizeTextarea(event.currentTarget);
              onDraftChange(event.currentTarget.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={draft}
          />

          <Button
            aria-label="语音输入"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#6f806f] transition duration-200 hover:scale-[1.06] hover:bg-[#e3f2de] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <MicIcon
              aria-hidden="true"
              className="size-6"
              size={24}
              strokeWidth={1.7}
            />
          </Button>

          <Button
            aria-label={
              taskRunning ? "暂停生成" : taskPaused ? "继续生成" : "发送"
            }
            className="flex size-9 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white shadow-none transition duration-200 enabled:bg-[linear-gradient(145deg,#68b96f,#397a52)] enabled:shadow-[0_10px_22px_-10px_rgba(47,104,69,0.9)] enabled:hover:-translate-y-0.5 enabled:hover:scale-[1.05] enabled:hover:bg-[linear-gradient(145deg,#74c67a,#2f6845)] enabled:hover:shadow-[0_13px_26px_-10px_rgba(47,104,69,0.95)] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#397a52] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[#d7e3d5] disabled:text-[#8b998b] disabled:opacity-100 disabled:hover:bg-[#d7e3d5] motion-reduce:transform-none"
            disabled={
              taskRunning
                ? !onPause
                : taskPaused
                  ? !onResume
                  : !canSubmit
            }
            onClick={
              taskRunning
                ? onPause
                : taskPaused
                  ? onResume
                  : undefined
            }
            size="icon"
            type={taskRunning || taskPaused ? "button" : "submit"}
            variant="ghost"
          >
            {taskRunning ? (
              <Pause
                aria-hidden="true"
                className="size-3.5"
                fill="currentColor"
                size={14}
                strokeWidth={1.7}
              />
            ) : taskPaused ? (
              <Play
                aria-hidden="true"
                className="size-3.5"
                fill="currentColor"
                size={14}
                strokeWidth={1.7}
              />
            ) : (
              <ArrowUpIcon
                aria-hidden="true"
                className="size-[19px]"
                size={19}
                strokeWidth={1.7}
              />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
