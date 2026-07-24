"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass as CompassIcon,
  Library as LibraryIcon,
  Sprout as SproutIcon,
} from "lucide-react";

const routeLinkClass =
  "flex h-[33px] items-center gap-2 rounded-full pl-2.5 pr-3 text-[14px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff9ee] sm:pl-[14px] sm:pr-[18px]";

export function SiteHeader() {
  const pathname = usePathname();
  const exploreActive = pathname === "/";
  const libraryActive = pathname.startsWith("/course");

  return (
    <nav className="fixed inset-x-0 top-0 z-50 h-[65px] w-full bg-[rgba(255,249,238,0.94)] backdrop-blur-[8px]">
      <div className="relative mx-auto flex h-16 w-full max-w-[1248px] items-center px-6">
        <Link
          aria-label="课芽首页"
          className="flex h-8 shrink-0 items-center gap-2 rounded-md text-[#2d332b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff9ee]"
          href="/"
        >
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-[#397a52] text-white shadow-[0_3px_10px_rgba(57,122,82,0.18)]">
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
                ? "bg-[rgba(57,122,82,0.11)] text-[#2d332b]"
                : "text-[#7a7468] hover:bg-[rgba(57,122,82,0.07)] hover:text-[#2d332b]"
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
                ? "bg-[rgba(57,122,82,0.11)] text-[#2d332b]"
                : "text-[#7a7468] hover:bg-[rgba(57,122,82,0.07)] hover:text-[#2d332b]"
            }`}
            href="/course"
          >
            <LibraryIcon aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>我的</span>
          </Link>
        </div>

        <span className="ml-auto text-xs text-[#7a7468]">数据已本地保存</span>
      </div>
    </nav>
  );
}
