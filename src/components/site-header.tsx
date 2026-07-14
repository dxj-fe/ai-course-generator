"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown as ChevronDownIcon,
  Compass as CompassIcon,
  Library as LibraryIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const routeLinkClass =
  "flex h-[33px] items-center gap-2 rounded-full pl-2.5 pr-3 text-[14px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcf9f2] sm:pl-[14px] sm:pr-[18px]";

export function SiteHeader() {
  const pathname = usePathname();
  const exploreActive = pathname === "/";
  const libraryActive = pathname === "/course";

  return (
    <nav className="fixed inset-x-0 top-0 z-50 h-[65px] w-full bg-[#fcf9f2] backdrop-blur-[6px]">
      <div className="relative mx-auto flex h-16 w-full max-w-[1248px] items-center px-6">
        <Link
          aria-label="Seaca 首页"
          className="flex h-7 shrink-0 items-center gap-1 rounded-sm text-[#76685b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcf9f2]"
          href="/"
        >
          <Image
            alt=""
            className="h-[22px] w-5 object-contain"
            height={22}
            priority
            src="/seaca/images/logo-mark.webp"
            width={20}
          />
          <span className="text-[16px] font-medium leading-7">SEACA</span>
        </Link>

        <div className="ml-1.5 flex shrink-0 items-center gap-1 sm:absolute sm:left-1/2 sm:ml-0 sm:-translate-x-1/2">
          <Link
            aria-current={exploreActive ? "page" : undefined}
            className={`${routeLinkClass} ${libraryActive ? "max-sm:hidden" : ""} ${
              exploreActive
                ? "bg-[rgba(173,150,136,0.15)] text-[#382c19]"
                : "text-[#988e80] hover:bg-[rgba(173,150,136,0.1)] hover:text-[#382c19]"
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
                ? "bg-[rgba(173,150,136,0.15)] text-[#382c19]"
                : "text-[#988e80] hover:bg-[rgba(173,150,136,0.1)] hover:text-[#382c19]"
            }`}
            href="/course"
          >
            <LibraryIcon aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>我的</span>
          </Link>
        </div>

        <div className="relative ml-auto min-w-0 max-w-[174px] sm:max-w-none">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="seaca_d931d5e4 用户菜单"
                className="flex h-8 max-w-full items-center gap-2 rounded-full border-0 bg-transparent pr-1 pl-0 text-[#382c19] font-normal transition-opacity duration-150 hover:bg-transparent hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcf9f2] aria-expanded:bg-transparent aria-expanded:text-[#382c19]"
                type="button"
                variant="ghost"
              >
                <Image
                  alt="seaca_d931d5e4"
                  className="size-8 shrink-0 rounded-full object-cover"
                  height={32}
                  priority
                  src="/seaca/images/seaca6.png"
                  width={32}
                />
                <span className="min-w-0 truncate text-[14px] leading-5">
                  seaca_d931d5e4
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]/button:rotate-180"
                  size={14}
                  strokeWidth={1.7}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40 overflow-hidden rounded-xl border border-[#ebe1d6] bg-[#fffdf7] p-1.5 text-[14px] text-[#382c19] shadow-[0_8px_24px_rgba(56,44,25,0.12)] ring-0"
              sideOffset={10}
            >
              <DropdownMenuItem
                className="flex h-9 w-full cursor-pointer items-center rounded-lg bg-transparent px-3 text-left transition-colors hover:bg-[#f5efe7] focus:bg-[#f5efe7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57]"
              >
                个人资料
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex h-9 w-full cursor-pointer items-center rounded-lg bg-transparent px-3 text-left text-[#76685b] transition-colors hover:bg-[#f5efe7] focus:bg-[#f5efe7] focus:text-[#76685b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#77cc57]"
              >
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}
