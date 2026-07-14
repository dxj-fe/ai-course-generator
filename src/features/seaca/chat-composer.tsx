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
  Languages,
  Lightbulb,
  LoaderCircle,
  Mic as MicIcon,
  Plus as PlusIcon,
  Presentation,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  draft: string;
  busy?: boolean;
  compact?: boolean;
  contextLabel?: string;
  onDraftChange(value: string): void;
  onSubmit(value: string): void;
  onSelectSuggestion?(value: string): void;
  showSuggestions: boolean;
}

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
  draft,
  busy = false,
  compact = false,
  contextLabel,
  onDraftChange,
  onSelectSuggestion,
  onSubmit,
  showSuggestions,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = draft.trim().length > 0 && !busy;

  useEffect(() => {
    if (textareaRef.current) {
      resizeTextarea(textareaRef.current);
    }
  }, [draft]);

  const submitDraft = () => {
    const value = draft.trim();
    if (value && !busy) {
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
                className="flex h-[33.5px] items-center gap-1.5 rounded-full border-0 bg-[rgba(253,250,247,0.7)] py-0 pr-4 pl-3.5 text-base leading-6 font-normal whitespace-nowrap shadow-[0_1.5px_1.7px_rgba(233,222,210,0.38),0_4px_14.5px_rgba(232,214,194,0.29)] transition-colors hover:bg-[rgba(253,251,248,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
                key={text}
                onClick={() => handleSuggestion(text)}
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
        ) : null}

        <div
          aria-busy={busy}
          className="flex min-h-[60px] items-center gap-2 rounded-[30px] border border-[#ebe1d6] bg-[#fffdf7] px-3 py-[11px] shadow-[0_2px_4px_rgba(91,76,59,0.05),0_8px_24px_rgba(91,76,59,0.06)]"
        >
          <Button
            aria-label="上传文件"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#988e80] transition-transform hover:scale-[1.08] hover:bg-transparent hover:text-[#5b4c3b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
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

          {contextLabel ? (
            <Badge
              className="flex h-auto shrink-0 items-center gap-1 overflow-visible rounded-full border-0 bg-[rgba(119,204,87,0.12)] px-2 py-1 text-xs font-medium text-[#5ba83e]"
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
            className="min-h-6 w-auto min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-1 text-sm leading-6 text-[#382c19] outline-none [field-sizing:fixed] placeholder:text-[#988e80] focus-visible:border-0 focus-visible:ring-0"
            onChange={(event) => {
              resizeTextarea(event.currentTarget);
              onDraftChange(event.currentTarget.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="想学点什么？慢慢找也可以..."
            ref={textareaRef}
            rows={1}
            value={draft}
          />

          <Button
            aria-label="语音输入"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[#988e80] transition hover:scale-[1.06] hover:bg-[rgba(119,204,87,0.14)] hover:text-[#5ba83e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57]"
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
            aria-label={busy ? "正在生成" : "发送"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 p-0 text-white transition enabled:bg-[#77cc57] enabled:hover:scale-[1.04] enabled:hover:bg-[#5ba83e] enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[#77cc57] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-[rgba(91,76,59,0.18)] disabled:opacity-100 disabled:hover:bg-[rgba(91,76,59,0.18)]"
            disabled={!canSubmit}
            size="icon"
            type="submit"
            variant="ghost"
          >
            {busy ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin"
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
