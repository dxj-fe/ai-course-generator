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
    <div className="w-full shrink-0 px-6 pb-[calc(22px+env(safe-area-inset-bottom))] max-sm:px-4 max-sm:pb-[calc(16px+env(safe-area-inset-bottom))]">
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
                className="min-w-0 rounded-2xl border border-[#e8dfd0] bg-[#fffcf5] px-3 py-2.5 text-xs text-[#6f6355] shadow-sm"
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
                          ? "bg-[#f3ece3] text-[#6f6a60]"
                          : "bg-[#edf5ee] text-[#397a52]"
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
                      className="size-7 rounded-full text-[#7a7468] hover:bg-[#f3ece3] hover:text-[#3f4a40]"
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
                      className="size-7 rounded-full text-[#7a7468] hover:bg-[#f3ece3] hover:text-[#3f4a40]"
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
                  <p className="mt-2 pl-6 leading-5 text-[#7a7468]">
                    正在提取正文并生成可引用摘要…
                  </p>
                ) : attachment.status === "error" ? (
                  <p className="mt-2 pl-6 leading-5 text-[#a54f3d]">
                    {attachment.error ?? "资料解析失败，请重试或移除。"}
                  </p>
                ) : (
                  <div className="mt-2 pl-6">
                    {attachment.summary ? (
                      <p className="line-clamp-2 leading-5 text-[#7a7468]">
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
                        <ul className="mt-2 grid gap-1 border-l border-[#dceadf] pl-3 leading-5 text-[#7a7468]">
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
                className="flex h-[33.5px] items-center gap-1.5 rounded-full border-0 bg-[rgba(253,250,247,0.7)] py-0 pr-4 pl-3.5 text-base leading-6 font-normal whitespace-nowrap shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] transition-colors hover:bg-[rgba(253,251,248,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
                key={text}
                onClick={() => handleSuggestion(text)}
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
        ) : null}

        <div
          aria-busy={busy}
          className="flex min-h-[60px] items-center gap-2 rounded-[30px] border border-[#e8dfd0] bg-[#fffcf5] px-3 py-[11px] shadow-[0_2px_4px_rgba(91,76,59,0.05),0_8px_24px_rgba(91,76,59,0.06)]"
        >
          <Button
            aria-label="上传文件"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#7a7468] transition-transform hover:scale-[1.08] hover:bg-transparent hover:text-[#3f4a40] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
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
              className="flex h-auto shrink-0 items-center gap-1 overflow-visible rounded-full border-0 bg-[rgba(57,122,82,0.12)] px-2 py-1 text-xs font-medium text-[#2f6845]"
              variant="secondary"
            >
              <Presentation
                aria-hidden="true"
                className="size-[15px]! shrink-0 text-[#dbc5ad]"
                size={15}
                strokeWidth={1.7}
              />
              {contextLabel}
            </Badge>
          ) : null}

          <Textarea
            aria-label="消息输入"
            className="min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-1 text-sm leading-6 text-[#2d332b] outline-none [field-sizing:fixed] placeholder:text-[#7a7468] focus-visible:border-0 focus-visible:ring-0"
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
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#7a7468] transition hover:scale-[1.06] hover:bg-[rgba(57,122,82,0.14)] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
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
            className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white transition enabled:bg-[#397a52] enabled:hover:scale-[1.04] enabled:hover:bg-[#2f6845] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#397a52] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[rgba(91,76,59,0.18)] disabled:opacity-100 disabled:hover:bg-[rgba(91,76,59,0.18)]"
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
