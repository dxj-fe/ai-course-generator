"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass as CompassIcon,
  Library as LibraryIcon,
  Sprout as SproutIcon,
} from "lucide-react";

const routeLinkClass =
  "flex h-[33px] items-center gap-2 rounded-full pl-2.5 pr-3 text-[14px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#eef8ea] sm:pl-[14px] sm:pr-[18px]";

export function SiteHeader() {
  const pathname = usePathname();
  const exploreActive = pathname === "/";
  const libraryActive = pathname.startsWith("/course");

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 h-[65px] w-full border-b backdrop-blur-[12px] transition-colors duration-300 ${
        exploreActive
          ? "border-[#dcebd7] bg-[rgba(244,250,239,0.9)] shadow-[0_8px_30px_-26px_rgba(47,104,69,0.45)]"
          : "border-[#d4e6cf] bg-[rgba(247,252,242,0.92)] shadow-[0_8px_30px_-26px_rgba(47,104,69,0.38)]"
      }`}
    >
      <div className="relative mx-auto flex h-16 w-full max-w-[1248px] items-center px-6">
        <Link
          aria-label="课芽首页"
          className={`group flex h-8 shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 ${
            exploreActive
              ? "text-[#245c3a] focus-visible:ring-offset-[#f4faef]"
              : "text-[#203d2a] focus-visible:ring-offset-[#eef8ea]"
          }`}
          href="/"
        >
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-[#397a52] text-white shadow-[0_5px_14px_rgba(57,122,82,0.24)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transform-none">
            <SproutIcon aria-hidden="true" size={17} strokeWidth={2} />
          </span>
          <span className="text-[17px] font-semibold leading-7 tracking-[0.08em]">
            课芽
          </span>
        </Link>

        <div className="ml-1.5 flex shrink-0 items-center gap-1 sm:absolute sm:left-1/2 sm:ml-0 sm:-translate-x-1/2">
          <Link
            aria-current={exploreActive ? "page" : undefined}
            className={`${routeLinkClass} ${libraryActive ? "max-sm:hidden" : ""} ${
              exploreActive
                ? "bg-[#dfeeda] font-medium text-[#245c3a] shadow-[inset_0_0_0_1px_rgba(57,122,82,0.08)]"
                : "text-[#607562] hover:bg-[rgba(57,122,82,0.09)] hover:text-[#203d2a]"
            }`}
            href="/"
          >
            <CompassIcon aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>探索</span>
          </Link>
          <Link
            aria-current={libraryActive ? "page" : undefined}
            className={`${routeLinkClass} ${libraryActive ? "" : "max-sm:hidden"} ${
              libraryActive
                ? "bg-[#dfeeda] font-medium text-[#245c3a] shadow-[inset_0_0_0_1px_rgba(57,122,82,0.08)]"
                : "text-[#607562] hover:bg-[rgba(57,122,82,0.09)] hover:text-[#203d2a]"
            }`}
            href="/course"
          >
            <LibraryIcon aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>我的</span>
          </Link>
        </div>

        <span
          className={`ml-auto hidden rounded-full px-3 py-1.5 text-xs sm:inline-flex ${
            exploreActive
              ? "bg-white/70 text-[#56705d]"
              : "bg-white/65 text-[#607562]"
          }`}
        >
          数据已本地保存
        </span>
      </div>
    </nav>
  );
}
