"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft as ArrowLeftIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  CirclePause as PausedIcon,
  Clock as ClockIcon,
  Ellipsis as MoreIcon,
  LoaderCircle as GeneratingIcon,
  MessageCircleMore as MessageIcon,
  Pencil as RenameIcon,
  Pin as PinIcon,
  PinOff as UnpinIcon,
  Plus as PlusIcon,
  Search as SearchIcon,
  Sprout,
  Trash2 as DeleteIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { KeyaConversation } from "@/types/keya";

interface ChatSidebarProps {
  conversations: KeyaConversation[];
  collapsed: boolean;
  selectedConversationId: string | null;
  onToggleCollapsed(): void;
  onSelectConversation(id: string): void;
  onNewConversation(): void;
  onDeleteConversation(id: string): void;
  onRenameConversation(id: string, title: string): void;
  onTogglePinned(id: string, pinned: boolean): void;
  inert?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?(): void;
}

interface ConversationRowsProps {
  conversations: KeyaConversation[];
  collapsed: boolean;
  selectedConversationId: string | null;
  onSelectConversation(id: string): void;
  onBeginRename(conversation: KeyaConversation): void;
  onDeleteConversation(id: string): void;
  onTogglePinned(id: string, pinned: boolean): void;
  editingConversationId: string | null;
  renameDraft: string;
  onRenameDraftChange(value: string): void;
  onRenameCancel(): void;
  onRenameSubmit(conversation: KeyaConversation): void;
  onCloseMobile?(): void;
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-1 focus-visible:ring-offset-[#fff9ee]";
const controlClass = `group flex h-9 w-[259px] items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-2 text-left text-base leading-6 font-normal whitespace-normal transition-[color,background-color,border-color,fill,stroke] duration-150 hover:bg-[rgba(91,76,59,0.07)] ${focusRing}`;

function ConversationRows({
  conversations,
  collapsed,
  editingConversationId,
  onBeginRename,
  onDeleteConversation,
  onRenameCancel,
  onRenameDraftChange,
  onRenameSubmit,
  selectedConversationId,
  onSelectConversation,
  onTogglePinned,
  renameDraft,
  onCloseMobile,
}: ConversationRowsProps) {
  return (
    <div className="pt-0.5">
      {conversations.map((conversation) => {
        const selected = conversation.id === selectedConversationId;
        const editing = conversation.id === editingConversationId;
        const generating =
          conversation.taskStatus === "queued" ||
          conversation.taskStatus === "running";
        const paused = conversation.taskStatus === "paused";

        return (
          <div
            className={`group relative h-[37px] w-[259px] rounded-lg transition-colors duration-150 hover:bg-[rgba(91,76,59,0.07)] ${
              selected ? "bg-[#f3ede4]" : ""
            }`}
            key={conversation.id}
          >
            {editing ? (
              <form
                aria-label={`重命名对话：${conversation.title}`}
                className="flex h-full w-full items-center gap-2 px-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameSubmit(conversation);
                }}
              >
                <RenameIcon
                  aria-hidden="true"
                  className="size-[17px] shrink-0 text-[#397a52]"
                  strokeWidth={1.7}
                />
                <Input
                  aria-label="新的对话名称"
                  autoFocus
                  className="h-7 min-w-0 flex-1 rounded-md border-[#d9cfbf] bg-[#fffcf5] px-2 text-sm text-[#2d332b] focus-visible:border-[#397a52] focus-visible:ring-1 focus-visible:ring-[#397a52]"
                  maxLength={160}
                  onBlur={() => onRenameSubmit(conversation)}
                  onChange={(event) =>
                    onRenameDraftChange(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  value={renameDraft}
                />
              </form>
            ) : (
              <>
                <Button
                  aria-current={selected ? "page" : undefined}
                  className={`flex h-full w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-2 pr-[39px] text-left font-normal hover:bg-transparent ${focusRing}`}
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    onCloseMobile?.();
                  }}
                  type="button"
                  variant="ghost"
                >
                  {generating ? (
                    <GeneratingIcon
                      aria-hidden="true"
                      className="size-[18px] shrink-0 animate-spin text-[#397a52] motion-reduce:animate-none"
                      strokeWidth={1.8}
                    />
                  ) : paused ? (
                    <PausedIcon
                      aria-hidden="true"
                      className="size-[18px] shrink-0 text-[#a27634]"
                      strokeWidth={1.7}
                    />
                  ) : (
                    <MessageIcon
                      aria-hidden="true"
                      className="shrink-0 text-[#3f4a40]"
                      size={18}
                      strokeWidth={1.7}
                    />
                  )}
                  <span
                    className={`flex min-w-0 flex-1 items-center gap-2 text-base leading-6 transition-opacity duration-150 ${
                      collapsed ? "opacity-0" : "opacity-100"
                    } ${generating ? "font-medium text-[#2f6845]" : "font-normal text-[#2d332b]"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {conversation.title}
                    </span>
                    {generating ? (
                      <span className="shrink-0 text-[10px] leading-4 font-medium text-[#397a52]">
                        生成中
                      </span>
                    ) : paused ? (
                      <span className="shrink-0 text-[10px] leading-4 font-medium text-[#946f32]">
                        已暂停
                      </span>
                    ) : null}
                  </span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={`${conversation.title} · 更多操作`}
                      className={`absolute top-1/2 right-[7px] flex size-[22px] -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#7a7468] transition-opacity duration-150 hover:bg-[rgba(91,76,59,0.1)] ${focusRing} ${
                        collapsed
                          ? "pointer-events-none opacity-0"
                          : selected
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                      }`}
                      size="icon-xs"
                      title={`${conversation.title} · 更多操作`}
                      type="button"
                      variant="ghost"
                    >
                      <MoreIcon
                        aria-hidden="true"
                        size={18}
                        strokeWidth={1.7}
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[172px] rounded-xl border border-[#e8dfd0] bg-[#fffcf5] p-1.5 text-[#3f3428] shadow-[0_12px_32px_rgba(63,52,40,0.14)]"
                    side="bottom"
                    sideOffset={4}
                  >
                    <DropdownMenuItem
                      className="h-9 gap-2.5 rounded-lg px-2.5 text-sm focus:bg-[#f3ede4]"
                      onSelect={() =>
                        onTogglePinned(conversation.id, !conversation.pinned)
                      }
                    >
                      {conversation.pinned ? (
                        <UnpinIcon aria-hidden="true" className="size-4" />
                      ) : (
                        <PinIcon aria-hidden="true" className="size-4" />
                      )}
                      {conversation.pinned ? "取消置顶" : "置顶对话"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="h-9 gap-2.5 rounded-lg px-2.5 text-sm focus:bg-[#f3ede4]"
                      onSelect={() => onBeginRename(conversation)}
                    >
                      <RenameIcon aria-hidden="true" className="size-4" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="mx-1 bg-[#eee5d7]" />
                    <DropdownMenuItem
                      className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                      onSelect={() => onDeleteConversation(conversation.id)}
                      variant="destructive"
                    >
                      <DeleteIcon aria-hidden="true" className="size-4" />
                      删除对话
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ChatSidebar({
  conversations,
  collapsed,
  selectedConversationId,
  onToggleCollapsed,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinned,
  inert = false,
  mobileOpen,
  onCloseMobile,
}: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  const [pinnedOpen, setPinnedOpen] = useState(() =>
    conversations.some(({ pinned }) => pinned),
  );
  const [historyOpen, setHistoryOpen] = useState(true);
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameSubmittingRef = useRef(false);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return conversations;

    return conversations.filter((conversation) =>
      conversation.title.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [conversations, query]);

  const pinnedConversations = filteredConversations.filter(
    (conversation) => conversation.pinned,
  );
  const historyConversations = filteredConversations.filter(
    (conversation) => !conversation.pinned,
  );
  const beginRename = (conversation: KeyaConversation) => {
    renameSubmittingRef.current = false;
    setEditingConversationId(conversation.id);
    setRenameDraft(conversation.title);
  };
  const finishRename = () => {
    setEditingConversationId(null);
    setRenameDraft("");
  };
  const cancelRename = () => {
    renameSubmittingRef.current = true;
    finishRename();
  };
  const submitRename = (conversation: KeyaConversation) => {
    if (renameSubmittingRef.current) return;
    renameSubmittingRef.current = true;
    const title = renameDraft.trim();
    if (title && title !== conversation.title) {
      onRenameConversation(conversation.id, title);
    }
    finishRename();
  };
  const railWidth = collapsed ? 60.5625 : 300;
  const mobileTransform =
    mobileOpen === false
      ? "invisible -translate-x-full delay-300 md:visible md:translate-x-0 md:delay-0"
      : "visible translate-x-0 delay-0";

  return (
    <>
      {mobileOpen && onCloseMobile ? (
        <Button
          aria-hidden={inert || undefined}
          aria-label="关闭侧栏"
          className="fixed inset-0 z-20 h-auto w-auto rounded-none border-0 bg-[#2d332b]/15 p-0 backdrop-blur-[1px] hover:bg-[#2d332b]/15 md:hidden"
          onClick={onCloseMobile}
          inert={inert ? true : undefined}
          type="button"
          variant="ghost"
        />
      ) : null}

      <div
        aria-hidden={inert || undefined}
        className={`fixed inset-y-0 left-0 z-30 h-dvh shrink-0 transition-[width,transform,visibility] duration-300 md:relative ${mobileTransform}`}
        inert={inert ? true : undefined}
        style={{ width: railWidth }}
      >
        <aside
          aria-label="对话侧栏"
          className="absolute inset-0 overflow-hidden border-r border-[#e8dfd0] bg-[#fff9ee]"
        >
          <div className="absolute left-5 top-3.5">
            <Link
              aria-label="返回课芽首页"
              className={`flex h-10 w-max items-center gap-3 rounded-lg px-2 text-lg font-semibold leading-6 text-foreground transition-colors duration-150 hover:bg-[rgba(91,76,59,0.07)] ${focusRing}`}
              href="/"
              onClick={onCloseMobile}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <Sprout aria-hidden="true" size={16} strokeWidth={2} />
              </span>
              <span
                className={`whitespace-nowrap transition-opacity duration-150 ${
                  collapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                课芽
              </span>
            </Link>

            <Link
              className={`mt-4 flex h-9 w-max items-center gap-3 rounded-lg px-2 text-base leading-6 text-[#3f4a40] transition-colors duration-150 hover:bg-[rgba(91,76,59,0.07)] ${focusRing}`}
              href="/"
              onClick={onCloseMobile}
            >
              <ArrowLeftIcon
                aria-hidden="true"
                className="shrink-0"
                size={18}
                strokeWidth={1.7}
              />
              <span
                className={`whitespace-nowrap transition-opacity duration-150 ${
                  collapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                返回
              </span>
            </Link>

            <Button
              className={`${controlClass} mt-4 bg-[#f3ede4] text-[#2d332b]`}
              onClick={() => {
                onNewConversation();
                onCloseMobile?.();
              }}
              type="button"
              variant="ghost"
            >
              <PlusIcon
                aria-hidden="true"
                className="shrink-0"
                size={18}
                strokeWidth={1.7}
              />
              <span
                className={`whitespace-nowrap transition-opacity duration-150 ${
                  collapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                新建
              </span>
            </Button>

            <label className="mt-1 flex h-9 w-[259px] items-center gap-3 rounded-lg px-2 text-[#3f4a40] focus-within:ring-2 focus-within:ring-[#397a52] focus-within:ring-offset-1 focus-within:ring-offset-[#fff9ee]">
              <SearchIcon
                aria-hidden="true"
                className="shrink-0"
                size={18}
                strokeWidth={1.7}
              />
              <span className="sr-only">搜索对话</span>
              <Input
                aria-label="搜索对话"
                className={`h-[34px] w-[213px] min-w-0 rounded-none border-0 bg-transparent p-0 text-base leading-6 font-semibold tracking-[-0.12px] text-[#3f4a40] outline-none placeholder:text-[#7a7468] focus-visible:border-0 focus-visible:ring-0 md:text-base ${
                  collapsed ? "pointer-events-none opacity-0" : "opacity-100"
                }`}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索对话"
                tabIndex={collapsed ? -1 : undefined}
                type="search"
                value={query}
              />
            </label>

            <Button
              aria-expanded={pinnedOpen}
              className={`${controlClass} mt-1 text-[#2d332b]`}
              onClick={() => setPinnedOpen((open) => !open)}
              type="button"
              variant="ghost"
            >
              <PinIcon
                aria-hidden="true"
                className="shrink-0"
                size={18}
                strokeWidth={1.7}
              />
              <span
                className={`min-w-0 flex-1 whitespace-nowrap transition-opacity duration-150 ${
                  collapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                置顶
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className={`shrink-0 transition-[opacity,transform] duration-150 ${
                  pinnedOpen ? "rotate-180" : ""
                } ${collapsed ? "opacity-0" : "opacity-100"}`}
                size={18}
                strokeWidth={1.7}
              />
            </Button>

            {pinnedOpen && pinnedConversations.length > 0 ? (
              <ConversationRows
                collapsed={collapsed}
                conversations={pinnedConversations}
                editingConversationId={editingConversationId}
                onBeginRename={beginRename}
                onCloseMobile={onCloseMobile}
                onDeleteConversation={onDeleteConversation}
                onRenameCancel={cancelRename}
                onRenameDraftChange={setRenameDraft}
                onRenameSubmit={submitRename}
                onSelectConversation={onSelectConversation}
                onTogglePinned={(id, pinned) => {
                  setPinnedOpen(true);
                  onTogglePinned(id, pinned);
                }}
                renameDraft={renameDraft}
                selectedConversationId={selectedConversationId}
              />
            ) : null}

            <Button
              aria-expanded={historyOpen}
              className={`${controlClass} mt-1 text-[#2d332b]`}
              onClick={() => setHistoryOpen((open) => !open)}
              type="button"
              variant="ghost"
            >
              <ClockIcon
                aria-hidden="true"
                className="shrink-0"
                size={18}
                strokeWidth={1.7}
              />
              <span
                className={`min-w-0 flex-1 whitespace-nowrap transition-opacity duration-150 ${
                  collapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                历史
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className={`shrink-0 transition-[opacity,transform] duration-150 ${
                  historyOpen ? "rotate-180" : ""
                } ${collapsed ? "opacity-0" : "opacity-100"}`}
                size={18}
                strokeWidth={1.7}
              />
            </Button>

            {historyOpen ? (
              <ConversationRows
                collapsed={collapsed}
                conversations={historyConversations}
                editingConversationId={editingConversationId}
                onBeginRename={beginRename}
                onCloseMobile={onCloseMobile}
                onDeleteConversation={onDeleteConversation}
                onRenameCancel={cancelRename}
                onRenameDraftChange={setRenameDraft}
                onRenameSubmit={submitRename}
                onSelectConversation={onSelectConversation}
                onTogglePinned={(id, pinned) => {
                  setPinnedOpen(true);
                  onTogglePinned(id, pinned);
                }}
                renameDraft={renameDraft}
                selectedConversationId={selectedConversationId}
              />
            ) : null}
          </div>

        </aside>

        <Button
          aria-label={collapsed ? "展开左侧栏" : "收起左侧栏"}
          className={`absolute left-full top-[38px] z-[31] hidden h-[35px] w-[27px] items-center justify-center rounded-r-[10px] border border-l-0 border-[#e8dfd0] bg-[#fffcf5] py-[11px] pr-2 pl-[7px] text-[#3f4a40] shadow-[2px_1px_8px_rgba(45,51,43,0.05)] transition-[left,background-color] duration-300 hover:bg-[#f6eedc] md:flex ${focusRing}`}
          onClick={onToggleCollapsed}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-300 ${
              collapsed ? "rotate-180" : ""
            }`}
            size={14}
            strokeWidth={1.7}
          />
        </Button>
      </div>
    </>
  );
}
