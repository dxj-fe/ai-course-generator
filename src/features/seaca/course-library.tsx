"use client";

import { useEffect, useState } from "react";
import { Clock as ClockIcon, Search as SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import type { CourseLibraryTab } from "@/types/seaca";

const tabs: Array<{ id: CourseLibraryTab; label: string; query: string }> = [
  { id: "learning", label: "学习", query: "learning" },
  { id: "works", label: "作品", query: "works" },
  { id: "likes", label: "点赞", query: "likes" },
  { id: "saved", label: "收藏", query: "favorites" },
];

const emptyCopy: Record<CourseLibraryTab, string> = {
  learning: "去探索广场发现喜欢的作品吧",
  works: "开始创作属于你的第一个作品吧",
  likes: "为喜欢的作品点个赞吧",
  saved: "收藏喜欢的作品，随时回来看看吧",
};

function tabFromLocation(): CourseLibraryTab {
  const query = new URLSearchParams(window.location.search).get("tab");
  return tabs.find((tab) => tab.query === query)?.id ?? "learning";
}

export function CourseLibrary() {
  const [activeTab, setActiveTab] = useState<CourseLibraryTab>("learning");
  const [query, setQuery] = useState("");
  const [sortPressed, setSortPressed] = useState(false);

  useEffect(() => {
    const syncTab = () => setActiveTab(tabFromLocation());
    syncTab();
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  const selectTab = (tab: (typeof tabs)[number]) => {
    setActiveTab(tab.id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab.query);
    window.history.pushState({}, "", url);
  };

  const hasQuery = query.trim().length > 0;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#fcf9f2] pb-16 text-[#382c19]">
      <Tabs
        className="mx-auto block w-[calc(100%-48px)] max-w-[1200px] pt-8"
        onValueChange={(value) => {
          const tab = tabs.find(({ id }) => id === value);
          if (tab) selectTab(tab);
        }}
        value={activeTab}
      >
        <TabsList
          aria-label="课程库分类"
          className="scrollbar-hide flex h-12 w-full justify-start overflow-x-auto rounded-none border-b border-[#e8e1d7] bg-transparent p-0 text-inherit group-data-horizontal/tabs:h-12"
          variant="line"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <TabsTrigger
                aria-controls={`course-library-panel-${tab.id}`}
                aria-selected={isActive}
                className={`relative h-12 w-[84.7656px] flex-none shrink-0 rounded-none border-0 bg-transparent p-0 text-[20px] leading-7 shadow-none transition-colors after:hidden hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#77cc57] data-active:bg-transparent data-active:shadow-none ${
                  isActive
                    ? "font-semibold text-[#382c19]"
                    : "font-normal text-[#988e80] hover:text-[#665b4d]"
                }`}
                id={`course-tab-${tab.id}`}
                key={tab.id}
                value={tab.id}
              >
                {tab.label}
                {isActive ? (
                  <span className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-[#77cc57]" />
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-7 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
          <Toggle
            className={`flex h-10 w-[113.125px] shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77cc57] max-sm:self-start ${
              sortPressed
                ? "bg-[#e8dfd3] data-[state=on]:bg-[#e8dfd3]"
                : "bg-[#f3ede4] hover:bg-[#ece4d9]"
            }`}
            onPressedChange={setSortPressed}
            pressed={sortPressed}
            type="button"
          >
            <ClockIcon
              aria-hidden="true"
              size={15}
              strokeWidth={1.7}
            />
            最近打开
          </Toggle>

          <label className="flex h-10 w-60 items-center gap-2 rounded-full bg-[#f3ede4] px-4 text-[#988e80] transition-shadow focus-within:ring-1 focus-within:ring-[#77cc57] max-sm:w-full">
            <SearchIcon
              aria-hidden="true"
              className="shrink-0"
              size={17}
              strokeWidth={1.7}
            />
            <span className="sr-only">搜索在学的作品</span>
            <Input
              className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm text-[#382c19] outline-none placeholder:text-[#988e80] focus-visible:border-0 focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索在学的作品"
              type="search"
              value={query}
            />
          </label>
        </div>

        {tabs.map((tab) => (
          <TabsContent
            aria-labelledby={`course-tab-${tab.id}`}
            asChild
            className="mt-[101px] text-center text-inherit outline-none"
            id={`course-library-panel-${tab.id}`}
            key={tab.id}
            value={tab.id}
          >
            <section>
              <h1 className="text-base font-semibold leading-6">
                {hasQuery ? "没有找到相关作品" : "这里还空空的"}
              </h1>
              <p className="mt-2 text-sm leading-[21px] text-[#988e80]">
                {hasQuery ? "试试其他关键词吧" : emptyCopy[tab.id]}
              </p>
            </section>
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
