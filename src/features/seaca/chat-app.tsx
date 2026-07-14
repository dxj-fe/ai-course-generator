"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronLeft as ChevronLeftIcon,
  MessageCircleMore as MessageIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  designCourse,
  evaluateCoursePage,
  generateCoursePageAssets,
  generateCoursePageHtml,
  planCourse,
  writeCoursePage,
} from "@/features/course-planner/lib/course-planner-api";
import { ChatComposer } from "@/features/seaca/chat-composer";
import { ChatSidebar } from "@/features/seaca/chat-sidebar";
import { ChatThread } from "@/features/seaca/chat-thread";
import { CourseWorkspacePanel } from "@/features/seaca/course-workspace-panel";
import { conversations as initialConversations } from "@/data/seaca";
import { saveGeneratedHtmlPreview } from "@/shared/html-preview";
import type {
  SeacaChatMessage,
  SeacaConversation,
  SeacaCourseRun,
} from "@/types/seaca";

function cloneConversations() {
  return initialConversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  }));
}

function currentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function messageId(role: "user" | "assistant") {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function conversationTitle(prompt: string) {
  return prompt.length > 18 ? `${prompt.slice(0, 18)}…` : prompt;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "请求已取消。";
  }

  return error instanceof Error ? error.message : fallback;
}

function updateConversation(
  conversations: SeacaConversation[],
  conversationId: string,
  updater: (conversation: SeacaConversation) => SeacaConversation,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

function updateMessage(
  messages: SeacaChatMessage[],
  id: string,
  patch: Partial<SeacaChatMessage>,
) {
  return messages.map((message) =>
    message.id === id ? { ...message, ...patch } : message,
  );
}

function subscribeToWorkspaceOverlay(onChange: () => void) {
  const query = window.matchMedia("(max-width: 1023px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getWorkspaceOverlaySnapshot() {
  return window.matchMedia("(max-width: 1023px)").matches;
}

function getServerWorkspaceOverlaySnapshot() {
  return false;
}

interface ChatAppProps {
  initialConversationId?: string;
  initialPrompt?: string;
}

export function ChatApp({
  initialConversationId,
  initialPrompt = "",
}: ChatAppProps) {
  const [conversations, setConversations] = useState<SeacaConversation[]>(
    cloneConversations,
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialConversations.some(({ id }) => id === initialConversationId)
      ? (initialConversationId ?? null)
      : null,
  );
  const [draft, setDraft] = useState(initialPrompt);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(
    null,
  );
  const requestControllers = useRef(new Set<AbortController>());
  const selectedIdRef = useRef(selectedId);
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceToggleRef = useRef<HTMLButtonElement>(null);
  const workspaceWasOpenRef = useRef(false);
  const workspaceOverlay = useSyncExternalStore(
    subscribeToWorkspaceOverlay,
    getWorkspaceOverlaySnapshot,
    getServerWorkspaceOverlaySnapshot,
  );
  const workspaceIsModal = rightPanelOpen && workspaceOverlay;

  const selectConversation = (conversationId: string | null) => {
    selectedIdRef.current = conversationId;
    setSelectedId(conversationId);
  };

  useEffect(
    () => () => {
      requestControllers.current.forEach((controller) => controller.abort());
      requestControllers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (workspaceIsModal) {
      workspaceRef.current?.focus();
    } else if (workspaceWasOpenRef.current && !rightPanelOpen) {
      workspaceToggleRef.current?.focus();
    }

    workspaceWasOpenRef.current = rightPanelOpen;
  }, [rightPanelOpen, workspaceIsModal]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedId) ??
      null,
    [conversations, selectedId],
  );
  const selectedRun = selectedConversation?.courseRun;
  const busy = busyConversationId !== null;

  const createController = () => {
    const controller = new AbortController();
    requestControllers.current.add(controller);
    return controller;
  };

  const releaseController = (controller: AbortController) => {
    requestControllers.current.delete(controller);
  };

  const handleNewConversation = () => {
    selectConversation(null);
    setDraft("");
    setRightPanelOpen(false);
  };

  const handleSelectConversation = (conversationId: string) => {
    selectConversation(conversationId);
    setRightPanelOpen(
      Boolean(
        conversations.find(({ id }) => id === conversationId)?.courseRun,
      ),
    );
  };

  const handleSuggestion = (value: string) => {
    if (value === "练一段地道英文对话") {
      selectConversation("spoken-english");
      setDraft("");
      setRightPanelOpen(false);
      return;
    }
    setDraft(value);
  };

  const handleSubmit = async (value: string) => {
    const text = value.trim();
    if (!text || busy) return;

    const startedAt = Date.now();
    const conversationId = selectedId ?? `local-${startedAt}`;
    const assistantId = messageId("assistant");
    const traceId = crypto.randomUUID();
    const time = currentTime();
    const userMessage: SeacaChatMessage = {
      id: messageId("user"),
      role: "user",
      content: text,
      time,
    };
    const assistantMessage: SeacaChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在理解你的课程需求并规划学习路径…",
      time,
    };
    const courseRun: SeacaCourseRun = {
      id: `run-${startedAt}`,
      prompt: text,
      traceId,
      startedAt,
      planner: { status: "running", events: [] },
      design: { status: "idle", events: [] },
      pageWrites: {},
      pageAssets: {},
      pageHtml: {},
      pageQa: {},
    };

    setConversations((current) => {
      const existing = current.find(
        (conversation) => conversation.id === conversationId,
      );

      if (!existing) {
        return [
          ...current,
          {
            id: conversationId,
            title: conversationTitle(text),
            messages: [userMessage, assistantMessage],
            courseRun,
          },
        ];
      }

      return updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        title:
          conversation.title === "未命名会话"
            ? conversationTitle(text)
            : conversation.title,
        messages: [...conversation.messages, userMessage, assistantMessage],
        courseRun,
      }));
    });
    selectConversation(conversationId);
    setDraft("");
    setBusyConversationId(conversationId);

    const controller = createController();

    try {
      const result = await planCourse(
        { userPrompt: text },
        { signal: controller.signal, traceId },
      );
      const outline = result.state.outline;
      const completed = result.state.status === "completed" && outline;
      const duration = `${Math.max(1, Math.round((Date.now() - startedAt) / 1_000))}s`;

      if (!completed) {
        const message =
          result.state.error?.message ?? "Course Planner 未生成有效课程大纲。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            messages: updateMessage(conversation.messages, assistantId, {
              content: `课程规划没有完成：${message}`,
            }),
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  planner: {
                    status: "failed",
                    events: result.state.events,
                    data: result,
                    error: message,
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, assistantId, {
            content: `已完成「${result.intent.topic}」的 ${outline.pages.length} 页课程规划。右侧学习空间中可以查看大纲，并继续生成教学、故事与视觉方案。`,
            duration,
          }),
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                planner: {
                  status: "completed",
                  events: result.state.events,
                  data: result,
                },
              }
            : conversation.courseRun,
        })),
      );
      if (selectedIdRef.current === conversationId) {
        setRightPanelOpen(true);
      }
    } catch (error) {
      const message = getErrorMessage(error, "Course Planner 请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, assistantId, {
            content: `课程规划没有完成：${message}`,
          }),
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                planner: {
                  ...conversation.courseRun.planner,
                  status: "failed",
                  error: message,
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleGenerateDesign = async () => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const planner = run?.planner.data;
    const outline = planner?.state.outline;

    if (!conversationId || !run || !planner || !outline || busy) return;

    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        courseRun: conversation.courseRun
          ? {
              ...conversation.courseRun,
              design: { status: "running", events: [] },
              pageWrites: {},
              pageAssets: {},
              pageHtml: {},
              pageQa: {},
            }
          : conversation.courseRun,
      })),
    );
    const controller = createController();

    try {
      const result = await designCourse(
        { intent: planner.intent, outline },
        { signal: controller.signal, traceId: run.traceId },
      );
      const completed =
        result.state.status === "completed" &&
        result.state.briefs &&
        result.state.pageWorkerBriefs;

      if (!completed) {
        const message =
          result.state.error?.message ?? "专业设计工作流未生成有效结果。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  design: {
                    status: "failed",
                    events: result.state.events,
                    data: result,
                    error: message,
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                design: {
                  status: "completed",
                  events: result.state.events,
                  data: result,
                },
              }
            : conversation.courseRun,
        })),
      );
    } catch (error) {
      const message = getErrorMessage(error, "专业设计工作流请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                design: {
                  ...conversation.courseRun.design,
                  status: "failed",
                  error: message,
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleGeneratePage = async (pageId: string) => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const planner = run?.planner.data;
    const design = run?.design.data;
    const page = planner?.state.outline?.pages.find(({ id }) => id === pageId);
    const brief = design?.state.pageWorkerBriefs?.find(
      (item) => item.pageId === pageId,
    );

    if (!conversationId || !run || !planner || !page || !brief || busy) return;

    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        courseRun: conversation.courseRun
          ? {
              ...conversation.courseRun,
              pageWrites: {
                ...conversation.courseRun.pageWrites,
                [pageId]: { status: "running", events: [] },
              },
              pageAssets: {
                ...conversation.courseRun.pageAssets,
                [pageId]: { status: "idle", events: [] },
              },
              pageHtml: {
                ...conversation.courseRun.pageHtml,
                [pageId]: { status: "idle", events: [] },
              },
              pageQa: {
                ...conversation.courseRun.pageQa,
                [pageId]: { status: "idle", events: [] },
              },
            }
          : conversation.courseRun,
      })),
    );
    const controller = createController();

    try {
      const result = await writeCoursePage(
        { intent: planner.intent, page, brief },
        { signal: controller.signal, traceId: run.traceId },
      );
      const completed =
        result.state.status === "completed" && result.state.content;

      if (!completed) {
        const message =
          result.state.error?.message ?? "Page Writer 未生成有效内容。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  pageWrites: {
                    ...conversation.courseRun.pageWrites,
                    [pageId]: {
                      status: "failed",
                      events: result.state.events,
                      data: result,
                      error: message,
                    },
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageWrites: {
                  ...conversation.courseRun.pageWrites,
                  [pageId]: {
                    status: "completed",
                    events: result.state.events,
                    data: result,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } catch (error) {
      const message = getErrorMessage(error, "Page Writer 请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageWrites: {
                  ...conversation.courseRun.pageWrites,
                  [pageId]: {
                    ...conversation.courseRun.pageWrites[pageId],
                    status: "failed",
                    events:
                      conversation.courseRun.pageWrites[pageId]?.events ?? [],
                    error: message,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleGenerateAssets = async (pageId: string) => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const content = run?.pageWrites[pageId]?.data?.state.content;
    const visualBrief = run?.design.data?.state.briefs?.visual;

    if (!conversationId || !run || !content || !visualBrief || busy) return;

    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        courseRun: conversation.courseRun
          ? {
              ...conversation.courseRun,
              pageAssets: {
                ...conversation.courseRun.pageAssets,
                [pageId]: { status: "running", events: [] },
              },
              pageHtml: {
                ...conversation.courseRun.pageHtml,
                [pageId]: { status: "idle", events: [] },
              },
              pageQa: {
                ...conversation.courseRun.pageQa,
                [pageId]: { status: "idle", events: [] },
              },
            }
          : conversation.courseRun,
      })),
    );
    const controller = createController();

    try {
      const result = await generateCoursePageAssets(
        { content, visualBrief },
        { signal: controller.signal, traceId: run.traceId },
      );
      const completed =
        result.state.status === "completed" && result.state.results;

      if (!completed) {
        const message =
          result.state.error?.message ?? "页面图片素材没有生成有效结果。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  pageAssets: {
                    ...conversation.courseRun.pageAssets,
                    [pageId]: {
                      status: "failed",
                      events: result.state.events,
                      data: result,
                      error: message,
                    },
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageAssets: {
                  ...conversation.courseRun.pageAssets,
                  [pageId]: {
                    status: "completed",
                    events: result.state.events,
                    data: result,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } catch (error) {
      const message = getErrorMessage(error, "图片素材生成请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageAssets: {
                  ...conversation.courseRun.pageAssets,
                  [pageId]: {
                    ...conversation.courseRun.pageAssets[pageId],
                    status: "failed",
                    events:
                      conversation.courseRun.pageAssets[pageId]?.events ?? [],
                    error: message,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleGenerateHtml = async (pageId: string) => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const content = run?.pageWrites[pageId]?.data?.state.content;
    const visualBrief = run?.design.data?.state.briefs?.visual;
    const assets = run?.pageAssets[pageId]?.data?.state.results;

    if (
      !conversationId ||
      !run ||
      !content ||
      !visualBrief ||
      (content.assetSlots.length > 0 && !assets) ||
      busy
    ) return;

    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        courseRun: conversation.courseRun
          ? {
              ...conversation.courseRun,
              pageHtml: {
                ...conversation.courseRun.pageHtml,
                [pageId]: { status: "running", events: [] },
              },
              pageQa: {
                ...conversation.courseRun.pageQa,
                [pageId]: { status: "idle", events: [] },
              },
            }
          : conversation.courseRun,
      })),
    );
    const controller = createController();

    try {
      const result = await generateCoursePageHtml(
        { content, visualBrief, assets: assets ?? [] },
        { signal: controller.signal, traceId: run.traceId },
      );
      const completed =
        result.state.status === "completed" && result.state.htmlOutput;

      if (!completed) {
        const message =
          result.state.error?.message ?? "HTML Engineer 未生成有效页面。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  pageHtml: {
                    ...conversation.courseRun.pageHtml,
                    [pageId]: {
                      status: "failed",
                      events: result.state.events,
                      data: result,
                      error: message,
                    },
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageHtml: {
                  ...conversation.courseRun.pageHtml,
                  [pageId]: {
                    status: "completed",
                    events: result.state.events,
                    data: result,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } catch (error) {
      const message = getErrorMessage(error, "HTML Engineer 请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageHtml: {
                  ...conversation.courseRun.pageHtml,
                  [pageId]: {
                    ...conversation.courseRun.pageHtml[pageId],
                    status: "failed",
                    events:
                      conversation.courseRun.pageHtml[pageId]?.events ?? [],
                    error: message,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleEvaluatePage = async (pageId: string) => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const outline = run?.planner.data?.state.outline;
    const pageIndex = outline?.pages.findIndex(({ id }) => id === pageId) ?? -1;
    const page = pageIndex >= 0 ? outline?.pages[pageIndex] : undefined;
    const content = run?.pageWrites[pageId]?.data?.state.content;
    const html = run?.pageHtml[pageId]?.data?.state.htmlOutput?.html;
    const visualBrief = run?.design.data?.state.briefs?.visual;
    const assets = run?.pageAssets[pageId]?.data?.state.results ?? [];

    if (
      !conversationId ||
      !run ||
      !outline ||
      !page ||
      !content ||
      !html ||
      !visualBrief ||
      busy
    ) {
      return;
    }

    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        courseRun: conversation.courseRun
          ? {
              ...conversation.courseRun,
              pageQa: {
                ...conversation.courseRun.pageQa,
                [pageId]: { status: "running", events: [] },
              },
            }
          : conversation.courseRun,
      })),
    );
    const controller = createController();

    try {
      const result = await evaluateCoursePage(
        {
          page,
          content,
          html,
          visualBrief,
          assets,
          courseContext: {
            learningObjectives: outline.learningObjectives,
            previousPage: outline.pages[pageIndex - 1],
            nextPage: outline.pages[pageIndex + 1],
          },
        },
        { signal: controller.signal, traceId: run.traceId },
      );
      const completed =
        result.state.status === "completed" && result.state.report;

      if (!completed) {
        const message = result.state.error?.message ?? "Page QA 未生成有效质量报告。";
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  pageQa: {
                    ...conversation.courseRun.pageQa,
                    [pageId]: {
                      status: "failed",
                      events: result.state.events,
                      data: result,
                      error: message,
                    },
                  },
                }
              : conversation.courseRun,
          })),
        );
        return;
      }

      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageQa: {
                  ...conversation.courseRun.pageQa,
                  [pageId]: {
                    status: "completed",
                    events: result.state.events,
                    data: result,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } catch (error) {
      const message = getErrorMessage(error, "Page QA 请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                pageQa: {
                  ...conversation.courseRun.pageQa,
                  [pageId]: {
                    ...conversation.courseRun.pageQa[pageId],
                    status: "failed",
                    events: conversation.courseRun.pageQa[pageId]?.events ?? [],
                    error: message,
                  },
                },
              }
            : conversation.courseRun,
        })),
      );
    } finally {
      releaseController(controller);
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  };

  const handleOpenHtmlPreview = (pageId: string) => {
    const page = selectedRun?.planner.data?.state.outline?.pages.find(
      ({ id }) => id === pageId,
    );
    const html = selectedRun?.pageHtml[pageId]?.data?.state.htmlOutput?.html;
    const qualityReport = selectedRun?.pageQa[pageId]?.data?.state.report;
    if (!page || !html) return;

    const preview = saveGeneratedHtmlPreview({
      html,
      pageId,
      qualityReport,
      title: page.title,
    });
    window.open(
      `/preview/${preview.id}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <main className="fixed inset-0 flex overflow-hidden bg-[#fcf9f2] text-[#382c19]">
      <ChatSidebar
        collapsed={collapsed}
        conversations={conversations}
        inert={workspaceIsModal}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        selectedConversationId={selectedId}
      />

      <section className="relative flex min-w-0 flex-1 overflow-hidden">
        <Button
          aria-label="打开对话侧栏"
          className="absolute top-3 left-3 z-20 flex size-10 items-center justify-center rounded-full border border-[#ebe1d6] bg-[#fffdf7] p-0 text-[#5b4c3b] shadow-sm hover:bg-[#fffdf7] focus-visible:outline-2 focus-visible:outline-[#77cc57] md:hidden"
          onClick={() => setMobileOpen(true)}
          inert={workspaceIsModal ? true : undefined}
          size="icon"
          type="button"
          variant="outline"
        >
          <MessageIcon
            aria-hidden="true"
            size={19}
            strokeWidth={1.7}
          />
        </Button>

        <div
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
          inert={workspaceIsModal ? true : undefined}
        >
          <ChatThread conversation={selectedConversation} />
          <ChatComposer
            busy={busy}
            compact={rightPanelOpen}
            contextLabel={
              selectedRun ? "课程" : selectedConversation ? "演示" : undefined
            }
            draft={draft}
            onDraftChange={setDraft}
            onSelectSuggestion={handleSuggestion}
            onSubmit={handleSubmit}
            showSuggestions={selectedConversation === null}
          />
        </div>

        {rightPanelOpen ? (
          <Button
            aria-label="关闭学习空间"
            className="absolute inset-0 z-10 h-auto w-auto rounded-none border-0 bg-[#382c19]/10 p-0 hover:bg-[#382c19]/10 lg:hidden"
            onClick={() => setRightPanelOpen(false)}
            type="button"
            variant="ghost"
          />
        ) : null}

        <aside
          aria-hidden={!rightPanelOpen}
          aria-label="学习空间"
          aria-modal={workspaceIsModal ? true : undefined}
          className={`shrink-0 overflow-hidden border-l border-[#ebe1d6] bg-[#fffdf7] transition-[width,visibility] duration-300 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 ${
            rightPanelOpen
              ? "visible w-[390px] max-md:w-full"
              : "invisible w-0 border-l-0"
          }`}
          id="course-learning-workspace"
          inert={!rightPanelOpen ? true : undefined}
          ref={workspaceRef}
          role={workspaceIsModal ? "dialog" : undefined}
          tabIndex={workspaceIsModal ? -1 : undefined}
        >
          <div className="scrollbar-hide h-full w-[390px] max-w-full overflow-y-auto max-md:w-screen">
            <CourseWorkspacePanel
              busy={busy}
              onGenerateDesign={handleGenerateDesign}
              onGenerateAssets={handleGenerateAssets}
              onGenerateHtml={handleGenerateHtml}
              onEvaluatePage={handleEvaluatePage}
              onGeneratePage={handleGeneratePage}
              onOpenHtmlPreview={handleOpenHtmlPreview}
              run={selectedRun}
            />
          </div>
        </aside>

        <Button
          aria-controls="course-learning-workspace"
          aria-expanded={rightPanelOpen}
          aria-label={rightPanelOpen ? "收起右侧栏" : "展开右侧栏"}
          className="absolute top-[38px] right-0 z-30 flex h-[35px] w-[27px] items-center justify-center rounded-l-[10px] border border-r-0 border-[#ebe1d6] bg-[#fffdf7] p-0 text-[#5b4c3b] hover:bg-[#fffdf7] focus-visible:outline-2 focus-visible:outline-[#77cc57]"
          onClick={() => setRightPanelOpen((value) => !value)}
          ref={workspaceToggleRef}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon
            aria-hidden="true"
            className={`transition-transform duration-300 ${
              rightPanelOpen ? "rotate-180" : ""
            }`}
            size={14}
            strokeWidth={1.7}
          />
        </Button>
      </section>
    </main>
  );
}
