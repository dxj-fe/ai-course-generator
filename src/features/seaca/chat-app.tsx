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
import { useSSETask } from "@/features/course-planner/hooks/use-sse-task";
import {
  designCourse,
  evaluateCoursePage,
  generateCoursePageAssets,
  generateCoursePageHtml,
  writeCoursePage,
} from "@/features/course-planner/lib/course-planner-api";
import { courseGenerationToSeacaRun } from "@/features/course-planner/lib/course-generation-adapter";
import {
  cancelCourseTask,
  createCourseTask,
} from "@/features/course-planner/lib/course-task-api";
import { ChatComposer } from "@/features/seaca/chat-composer";
import { ChatSidebar } from "@/features/seaca/chat-sidebar";
import { ChatThread } from "@/features/seaca/chat-thread";
import { CourseWorkspacePanel } from "@/features/seaca/course-workspace-panel";
import { conversations as initialConversations } from "@/data/seaca";
import { saveGeneratedHtmlPreview } from "@/shared/html-preview";
import type { CourseGenerationState } from "@/shared/course-schema";
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

type ActiveCourseTask = {
  taskId: string;
  traceId: string;
  conversationId: string;
  assistantId: string;
  runId: string;
  prompt: string;
  runStartedAt: number;
  requestStartedAt: number;
  mode: "create" | "resume";
};

function mapStreamedCourseRun(
  state: CourseGenerationState,
  task: ActiveCourseTask,
) {
  return courseGenerationToSeacaRun(
    {
      courseId: state.courseId,
      traceId: state.traceId,
      state,
    },
    {
      id: task.runId,
      taskId: task.taskId,
      prompt: task.prompt,
      startedAt: task.runStartedAt,
    },
  );
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
  const [activeCourseTask, setActiveCourseTask] =
    useState<ActiveCourseTask | null>(null);
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

  const finishCourseTask = (state: CourseGenerationState) => {
    const task = activeCourseTask;
    if (!task || state.traceId !== task.traceId) return;

    const mappedRun = mapStreamedCourseRun(state, task);
    const completedPageCount = state.pages.filter(
      ({ status }) => status === "completed",
    ).length;
    const duration = `${Math.max(
      1,
      Math.round((Date.now() - task.requestStartedAt) / 1_000),
    )}s`;
    const terminalMessage =
      state.status === "completed"
        ? task.mode === "resume"
          ? `已从断点完成全部 ${completedPageCount} 页课程。`
          : `已完成「${state.intent?.topic ?? task.prompt}」的 ${state.outline?.pages.length ?? completedPageCount} 页课程。右侧学习空间可以统一预览 HTML，也可逐页检查素材与结果。`
        : `${state.status === "cancelled" ? "课程生成已取消" : task.mode === "resume" ? "断点恢复仍未完成" : "课程生成未完成"}：${state.errors.at(-1)?.message ?? "未知错误"} 已保留 ${completedPageCount} 个完成页面。`;

    setConversations((current) =>
      updateConversation(current, task.conversationId, (conversation) => ({
        ...conversation,
        messages: updateMessage(conversation.messages, task.assistantId, {
          content: terminalMessage,
          duration,
        }),
        courseRun: mappedRun,
      })),
    );
    if (selectedIdRef.current === task.conversationId) {
      setRightPanelOpen(true);
    }
    setBusyConversationId((current) =>
      current === task.conversationId ? null : current,
    );
    setActiveCourseTask((current) =>
      current?.taskId === task.taskId ? null : current,
    );
  };

  const handleCourseTaskStreamError = (error: Error) => {
    const task = activeCourseTask;
    if (!task) return;

    setConversations((current) =>
      updateConversation(current, task.conversationId, (conversation) => ({
        ...conversation,
        messages: updateMessage(conversation.messages, task.assistantId, {
          content: `实时进度连接已停止：${error.message} 服务端任务可能仍在运行，已保存的检查点不会丢失。`,
        }),
      })),
    );
    setBusyConversationId((current) =>
      current === task.conversationId ? null : current,
    );
    setActiveCourseTask((current) =>
      current?.taskId === task.taskId ? null : current,
    );
  };

  const {
    connectionStatus: courseTaskConnectionStatus,
    latestState: streamedCourseState,
    taskStatus: courseTaskStatus,
  } = useSSETask({
    taskId: activeCourseTask?.taskId ?? null,
    enabled: activeCourseTask !== null,
    onTerminal: ({ state }) => finishCourseTask(state),
    onError: handleCourseTaskStreamError,
  });

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
    const shouldRestoreToggleFocus =
      workspaceWasOpenRef.current && !rightPanelOpen;
    workspaceWasOpenRef.current = rightPanelOpen;

    const timer = window.setTimeout(() => {
      if (workspaceIsModal) {
        workspaceRef.current?.focus();
      } else if (shouldRestoreToggleFocus) {
        workspaceToggleRef.current?.focus();
      }
    }, workspaceIsModal ? 320 : 0);

    return () => window.clearTimeout(timer);
  }, [rightPanelOpen, workspaceIsModal]);

  const streamedCourseRun = useMemo(() => {
    if (
      !activeCourseTask ||
      !streamedCourseState ||
      streamedCourseState.traceId !== activeCourseTask.traceId
    ) {
      return undefined;
    }

    return mapStreamedCourseRun(streamedCourseState, activeCourseTask);
  }, [activeCourseTask, streamedCourseState]);
  const selectedConversation = useMemo(() => {
    const conversation =
      conversations.find(({ id }) => id === selectedId) ?? null;

    if (
      !conversation ||
      !streamedCourseRun ||
      conversation.id !== activeCourseTask?.conversationId
    ) {
      return conversation;
    }

    return { ...conversation, courseRun: streamedCourseRun };
  }, [
    activeCourseTask?.conversationId,
    conversations,
    selectedId,
    streamedCourseRun,
  ]);
  const selectedRun = selectedConversation?.courseRun;
  const selectedTaskTelemetry =
    selectedConversation &&
    activeCourseTask?.conversationId === selectedConversation.id
      ? {
          connectionStatus: courseTaskConnectionStatus,
          taskStatus: courseTaskStatus,
        }
      : undefined;
  const busy = busyConversationId !== null;

  const createController = () => {
    const controller = new AbortController();
    requestControllers.current.add(controller);
    return controller;
  };

  const releaseController = (controller: AbortController) => {
    requestControllers.current.delete(controller);
  };

  const handleCancel = () => {
    requestControllers.current.forEach((controller) => controller.abort());

    if (!activeCourseTask) return;

    const task = activeCourseTask;
    const controller = createController();
    void cancelCourseTask(task.taskId, {
      signal: controller.signal,
      traceId: task.traceId,
    })
      .catch((error) => {
        const message = getErrorMessage(error, "取消课程任务失败。");
        setConversations((current) =>
          updateConversation(current, task.conversationId, (conversation) => ({
            ...conversation,
            messages: updateMessage(conversation.messages, task.assistantId, {
              content: `课程任务暂时无法取消：${message}`,
            }),
          })),
        );
      })
      .finally(() => releaseController(controller));
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
    const courseId = `course-${crypto.randomUUID()}`;
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
      content: "正在串行生成课程规划、专业设计与多页 HTML…",
      time,
    };
    const courseRun: SeacaCourseRun = {
      id: `run-${startedAt}`,
      courseId,
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
      const task = await createCourseTask(
        { courseId, userPrompt: text },
        { signal: controller.signal, traceId },
      );
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                taskId: task.taskId,
                courseId: task.courseId,
                traceId: task.traceId,
              }
            : conversation.courseRun,
        })),
      );
      setActiveCourseTask({
        taskId: task.taskId,
        traceId: task.traceId,
        conversationId,
        assistantId,
        runId: courseRun.id,
        prompt: text,
        runStartedAt: startedAt,
        requestStartedAt: startedAt,
        mode: "create",
      });
      if (selectedIdRef.current === conversationId) {
        setRightPanelOpen(true);
      }
    } catch (error) {
      const message = getErrorMessage(error, "整课生成请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, assistantId, {
            content: `课程生成没有完成：${message}`,
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
      if (selectedIdRef.current === conversationId) {
        setRightPanelOpen(true);
      }
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    } finally {
      releaseController(controller);
    }
  };

  const handleResumeCourse = async () => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const courseId = run?.courseId;
    if (!conversationId || !run || !courseId || busy) return;

    const assistantId = messageId("assistant");
    const startedAt = Date.now();
    const knownPageCount = run.planner.data?.intent.courseLength;
    const pageCount =
      knownPageCount === 3 || knownPageCount === 4 || knownPageCount === 5
        ? knownPageCount
        : undefined;
    setBusyConversationId(conversationId);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: assistantId,
            role: "assistant",
            content: "正在从服务端检查点继续生成未完成页面…",
            time: currentTime(),
          },
        ],
      })),
    );
    const controller = createController();
    const traceId = crypto.randomUUID();

    try {
      const task = await createCourseTask(
        {
          courseId,
          userPrompt: run.prompt,
          ...(pageCount ? { pageCount } : {}),
        },
        { signal: controller.signal, traceId },
      );
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          courseRun: conversation.courseRun
            ? {
                ...conversation.courseRun,
                taskId: task.taskId,
                courseId: task.courseId,
                traceId: task.traceId,
              }
            : conversation.courseRun,
        })),
      );
      setActiveCourseTask({
        taskId: task.taskId,
        traceId: task.traceId,
        conversationId,
        assistantId,
        runId: run.id,
        prompt: run.prompt,
        runStartedAt: run.startedAt,
        requestStartedAt: startedAt,
        mode: "resume",
      });
    } catch (error) {
      const message = getErrorMessage(error, "断点恢复请求失败。");
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, assistantId, {
            content: `断点恢复没有完成：${message}`,
          }),
        })),
      );
      setBusyConversationId((current) =>
        current === conversationId ? null : current,
      );
    } finally {
      releaseController(controller);
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
          <ChatThread
            busy={busy}
            connectionStatus={selectedTaskTelemetry?.connectionStatus}
            conversation={selectedConversation}
            onResumeCourse={handleResumeCourse}
            taskStatus={selectedTaskTelemetry?.taskStatus}
          />
          <ChatComposer
            busy={busy}
            compact={rightPanelOpen}
            contextLabel={
              selectedRun ? "课程" : selectedConversation ? "演示" : undefined
            }
            draft={draft}
            onCancel={handleCancel}
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
              onResumeCourse={handleResumeCourse}
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
