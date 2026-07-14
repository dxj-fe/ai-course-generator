"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BookOpen as BookOpenIcon,
  Bookmark as BookmarkIcon,
  Clock as ClockIcon,
  Flame as FlameIcon,
  Search as SearchIcon,
  ThumbsUp as ThumbsUpIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { works } from "@/data/seaca";
import type { SeacaWork, WorkCoverVariant } from "@/types/seaca";

type SortMode = "popular" | "learning" | "likes" | "latest";

const sortOptions: Array<{
  id: SortMode;
  label: string;
  Icon: typeof FlameIcon;
}> = [
  { id: "popular", label: "综合热门", Icon: FlameIcon },
  { id: "learning", label: "最多学习", Icon: BookOpenIcon },
  { id: "likes", label: "最多点赞", Icon: ThumbsUpIcon },
  { id: "latest", label: "最新作品", Icon: ClockIcon },
];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfbf8]";

function CoverArtwork({
  title,
  variant,
}: {
  title: string;
  variant: WorkCoverVariant;
}) {
  if (variant === "english") {
    return (
      <div className="relative h-full overflow-hidden bg-[#e8e8f6] px-5 py-4 text-[#433d63]">
        <div className="absolute -right-5 -top-7 size-24 rounded-full bg-white/55" />
        <div className="absolute -bottom-6 -left-4 size-20 rounded-full bg-[#c9d8f3]" />
        <div className="relative flex h-full flex-col justify-between rounded-xl border border-white/80 bg-white/65 p-3 shadow-sm">
          <span className="text-[10px] font-semibold tracking-[0.22em] text-[#817ba0]">
            DAILY ENGLISH
          </span>
          <div className="text-[18px] font-bold leading-[1.28]">
            开口说英语
            <br />
            <span className="text-[13px] font-semibold">从 4 个场景 开始</span>
          </div>
          <div className="flex gap-1.5">
            {["Hi", "Go", "Eat", "Buy"].map((word) => (
              <span
                className="flex size-7 items-center justify-center rounded-full bg-[#7673a1] text-[8px] font-bold text-white"
                key={word}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "picasso") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#1e1b1c] text-[#f7e7c8]">
        <div className="absolute left-5 top-4 h-[105px] w-[82px] rotate-[-3deg] border-4 border-[#b68f4f] bg-[#554d63] shadow-xl">
          <div className="absolute left-2 top-2 size-10 rounded-full bg-[#d8a96a]" />
          <div className="absolute bottom-2 right-2 h-12 w-8 bg-[#6f8a78]" />
          <div className="absolute left-7 top-8 h-14 w-1 rotate-12 bg-[#201b23]" />
        </div>
        <div className="ml-24 w-[130px] border-y border-[#8c7658] py-3 text-left">
          <div className="text-[9px] tracking-[0.3em] text-[#bba98c]">ART & LIFE</div>
          <div className="mt-2 text-lg font-semibold leading-tight">
            毕加索生平
            <br />与作品赏析
          </div>
        </div>
      </div>
    );
  }

  if (variant === "printing") {
    return (
      <div
        className="relative flex h-full items-center justify-center overflow-hidden bg-[#174f7b] p-5 text-[#d9eff7]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      >
        <div className="relative w-full border border-[#9bc6d9] bg-[#1f658e]/90 px-4 py-3 shadow-lg">
          <div className="absolute inset-1 border border-dashed border-[#8eb8cb]" />
          <div className="relative text-[9px] tracking-[0.28em]">PRINTING TECH</div>
          <div className="relative mt-2 text-xl font-bold leading-tight">
            印钞过程与
            <br />核心技术详解
          </div>
        </div>
      </div>
    );
  }

  if (variant === "capital") {
    return (
      <div className="relative h-full overflow-hidden bg-[#efe1c6] p-5 text-[#33281e]">
        <div className="absolute -right-8 -top-12 size-36 rounded-full border-[22px] border-[#a33125]/20" />
        <div className="relative flex h-full border-2 border-[#9f3429] bg-[#f5ead4]/80">
          <div className="w-10 bg-[#9f3429] p-2 text-center text-[9px] font-semibold leading-3 tracking-[0.18em] text-[#f7ead1] [writing-mode:vertical-rl]">
            POLITICAL ECONOMY
          </div>
          <div className="flex flex-1 items-center px-4 text-xl font-bold leading-snug">
            零基础
            <br />《资本论》入门
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#eee5cf] text-[#46392d]">
      <div className="absolute inset-y-0 left-8 w-px bg-[#cbb99b]" />
      <div className="absolute inset-y-0 right-8 w-px bg-[#cbb99b]" />
      <div className="relative rotate-[-2deg] text-center font-serif">
        <div className="text-[10px] tracking-[0.45em] text-[#9a2f28]">宋 · 苏轼</div>
        <div className="mt-2 text-[25px] font-semibold tracking-[0.12em]">
          念奴娇
        </div>
        <div className="mt-1 text-sm tracking-[0.28em]">赤壁怀古</div>
      </div>
      <div className="absolute bottom-5 right-12 size-5 border border-[#a34136] text-center text-[8px] leading-[18px] text-[#a34136]">
        赏
      </div>
      <span className="sr-only">{title}</span>
    </div>
  );
}

function WorkCard({
  liked,
  onOpen,
  onOpenAuthor,
  onToggleLiked,
  onToggleSaved,
  saved,
  work,
}: {
  liked: boolean;
  onOpen(): void;
  onOpenAuthor(): void;
  onToggleLiked(): void;
  onToggleSaved(): void;
  saved: boolean;
  work: SeacaWork;
}) {
  return (
    <article className="group flex h-[344.5px] min-w-0 flex-col overflow-hidden rounded-xl border border-[rgba(235,225,214,0.5)] bg-[#fffdf7] shadow-[var(--seaca-card-shadow)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(56,44,25,0.2)]">
      <Button
        aria-label={`打开${work.title}`}
        className={`relative block h-auto aspect-video w-full shrink-0 justify-start overflow-hidden rounded-none border-0 bg-[#f2ece2] p-0 text-left font-normal whitespace-normal hover:bg-[#f2ece2] ${focusRing}`}
        onClick={onOpen}
        type="button"
        variant="ghost"
      >
        {work.image ? (
          <Image
            alt={`${work.title}封面`}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.015]"
            fill
            sizes="(max-width: 639px) 282px, (max-width: 1279px) 33vw, 282px"
            src={work.image}
          />
        ) : work.coverVariant ? (
          <CoverArtwork title={work.title} variant={work.coverVariant} />
        ) : null}
      </Button>

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
        <h3 className="h-5 min-w-0 text-base font-semibold leading-5 text-[#382c19]">
          <Button
            className={`block h-auto max-w-full truncate rounded-sm border-0 p-0 text-left text-base font-semibold hover:bg-transparent hover:text-[#5ba83e] ${focusRing}`}
            onClick={onOpen}
            type="button"
            variant="ghost"
          >
            {work.title}
          </Button>
        </h3>
        <p className="mt-1.5 line-clamp-2 min-h-10 text-sm leading-5 text-[#76685b]">
          {work.description}
        </p>
        <p className="mt-1 h-4 truncate text-xs font-semibold leading-4 text-[#ad9688]">
          {work.tags.map((tag) => `#${tag}`).join("  ")}
        </p>

        <div className="mt-auto border-t border-dotted border-[#efe7df] pt-2">
          <div className="flex h-10 items-center gap-1">
            <Button
              aria-label={`认识${work.author}`}
              className={`flex h-8 min-w-0 flex-1 items-center justify-start gap-2 rounded-full border-0 py-1 pl-1 pr-2 text-left text-xs font-normal text-[#76685b] transition-colors hover:bg-[#f5efe7] ${focusRing}`}
              onClick={onOpenAuthor}
              type="button"
              variant="ghost"
            >
              <Image
                alt=""
                className="size-6 shrink-0 rounded-full object-cover"
                height={24}
                src={work.avatar}
                width={24}
              />
              <span className="truncate">{work.author}</span>
            </Button>

            <Toggle
              aria-label="点赞"
              className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs font-normal transition-colors hover:bg-[#f5efe7] ${focusRing} ${
                liked
                  ? "bg-[#edf7e9] text-[#4f9636] data-[state=on]:bg-[#edf7e9] data-[state=on]:text-[#4f9636]"
                  : "text-[#76685b]"
              }`}
              onPressedChange={onToggleLiked}
              pressed={liked}
              type="button"
            >
              <ThumbsUpIcon
                aria-hidden="true"
                className="size-4"
                size={16}
                strokeWidth={1.7}
              />
              <span>{work.likes + (liked ? 1 : 0)}</span>
            </Toggle>
            <Toggle
              aria-label="收藏"
              className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs font-normal transition-colors hover:bg-[#f5efe7] ${focusRing} ${
                saved
                  ? "bg-[#edf7e9] text-[#4f9636] data-[state=on]:bg-[#edf7e9] data-[state=on]:text-[#4f9636]"
                  : "text-[#76685b]"
              }`}
              onPressedChange={onToggleSaved}
              pressed={saved}
              type="button"
            >
              <BookmarkIcon
                aria-hidden="true"
                className="size-4"
                size={16}
                strokeWidth={1.7}
              />
              <span>{work.saves + (saved ? 1 : 0)}</span>
            </Toggle>
          </div>
        </div>
      </div>
    </article>
  );
}

export function WorkGallery() {
  const router = useRouter();
  const [sortMode, setSortMode] = useState<SortMode>("popular");
  const [query, setQuery] = useState("");
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

  const visibleWorks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = works.filter((work) => {
      const searchableText = [
        work.title,
        work.description,
        work.author,
        ...work.tags,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchableText.includes(normalizedQuery);
    });

    if (sortMode === "latest") return [...filtered].reverse();
    if (sortMode === "likes") {
      return [...filtered].sort((a, b) => b.likes - a.likes);
    }
    if (sortMode === "learning") {
      return [...filtered].sort(
        (a, b) => b.likes + b.saves - (a.likes + a.saves),
      );
    }
    return filtered;
  }, [query, sortMode]);

  const openPrompt = (prompt: string) => {
    router.push(`/chat?${new URLSearchParams({ prompt }).toString()}`);
  };

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="bg-[#fdfbf8] pb-[215px] pt-16" id="work-gallery">
      <div className="mx-auto w-[calc(100%-48px)] max-w-[1200px]">
        <h2 className="text-2xl font-semibold leading-8 text-[#ad9688]">
          今天，为你推荐
        </h2>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <ToggleGroup
            className="grid w-[234.25px] grid-cols-2 gap-2 sm:w-[476.5px] sm:grid-cols-4"
            onValueChange={(value) => {
              if (value) setSortMode(value as SortMode);
            }}
            type="single"
            value={sortMode}
          >
            {sortOptions.map(({ id, label, Icon }) => {
              const active = sortMode === id;
              return (
                <ToggleGroupItem
                  aria-label={label}
                  className={`flex h-10 w-[113.125px] items-center justify-center gap-2 rounded-full px-4 text-sm leading-[14px] transition-colors duration-150 ${focusRing} ${
                    active
                      ? "bg-[#f6d4ca] font-bold text-[#8e2f20] data-[state=on]:bg-[#f6d4ca] data-[state=on]:text-[#8e2f20]"
                      : "bg-[#f8f2ea] font-medium text-[#76685b] hover:bg-[#f2e9df]"
                  }`}
                  key={id}
                  value={id}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    size={16}
                    strokeWidth={1.7}
                  />
                  <span className="whitespace-nowrap">{label}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          <label className="flex h-10 w-[282px] items-center gap-2 rounded-full border border-[#ebe1d6] bg-[#fffdf7] px-4 text-[#988e80] transition-shadow focus-within:ring-2 focus-within:ring-[#77cc57] focus-within:ring-offset-2 focus-within:ring-offset-[#fdfbf8]">
            <SearchIcon
              aria-hidden="true"
              className="shrink-0"
              size={16}
              strokeWidth={1.7}
            />
            <span className="sr-only">搜索作品</span>
            <Input
              className="h-auto w-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm leading-[21px] text-[#382c19] outline-none placeholder:text-[#988e80] focus-visible:border-0 focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索作品"
              type="search"
              value={query}
            />
          </label>
        </div>

        {visibleWorks.length > 0 ? (
          <div className="mt-[25px] grid grid-cols-[282px] justify-start gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleWorks.map((work) => (
              <WorkCard
                key={work.id}
                liked={likedIds.has(work.id)}
                onOpen={() => openPrompt(work.title)}
                onOpenAuthor={() => openPrompt(`认识${work.author}`)}
                onToggleLiked={() => toggleSet(setLikedIds, work.id)}
                onToggleSaved={() => toggleSet(setSavedIds, work.id)}
                saved={savedIds.has(work.id)}
                work={work}
              />
            ))}
          </div>
        ) : (
          <p className="py-24 text-center text-sm text-[#988e80]">
            没有找到相关作品
          </p>
        )}
      </div>
    </section>
  );
}
