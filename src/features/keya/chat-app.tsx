"use client";

import {
  useEffect,
  useLayoutEffect,
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
  useSSETask,
  type CourseTaskConnectionStatus,
} from "@/features/course-planner/hooks/use-sse-task";
import {
  designCourse,
  evaluateCoursePage,
  generateCoursePageAssets,
  generateCoursePageHtml,
  writeCoursePage,
} from "@/features/course-planner/lib/course-planner-api";
import { courseGenerationToKeyaRun } from "@/features/course-planner/lib/course-generation-adapter";
import {
  downloadCourseArchive,
} from "@/features/course-planner/lib/course-library-api";
import { saveGeneratedHtmlPreview } from "@/features/course-planner/lib/html-preview-api";
import {
  deleteStoredConversation,
  saveConversation,
  updateStoredConversation,
} from "@/features/course-planner/lib/conversation-api";
import { parseReferenceFile } from "@/features/course-planner/lib/reference-api";
import {
  cancelCourseTask,
  createCourseTask,
  pauseCourseTask,
  resumeCourseTask,
} from "@/features/course-planner/lib/course-task-api";
import {
  ChatComposer,
  type ReferenceAttachment,
} from "@/features/keya/chat-composer";
import { ChatSidebar } from "@/features/keya/chat-sidebar";
import {
  createInitialTaskRegistry,
  removeRegisteredTask,
  updateConversationTaskStatus,
  type ActiveCourseTask,
  type ActiveCourseTaskRegistry,
} from "@/features/keya/chat-task-registry";
import { ChatThread } from "@/features/keya/chat-thread";
import {
  applyCourseCreationAnswer,
  buildCourseTaskPrompt,
  createCourseCreationBrief,
  deriveCourseCreationBrief,
  getNextClarificationQuestion,
  resolveCourseSectionCount,
  type ClarificationQuestionId,
  type CourseCreationBrief,
} from "@/features/keya/course-creation-model";
import { getCourseFailurePresentation } from "@/features/keya/course-run-timeline";
import { CourseWorkspacePanel } from "@/features/keya/course-workspace-panel";
import type {
  CourseGenerationState,
  CourseTaskStatus,
  ReferencePack,
} from "@/shared/course-schema";
import type {
  KeyaChatMessage,
  KeyaConversation,
  KeyaCourseRun,
} from "@/types/keya";

function cloneConversations(conversations: KeyaConversation[]) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  }));
}

function initialCourseBriefs(conversations: KeyaConversation[]) {
  return Object.fromEntries(
    conversations.flatMap((conversation) => {
      const hasUserRequest = conversation.messages.some(
        ({ role }) => role === "user",
      );
      return !conversation.courseRun && hasUserRequest
        ? [[conversation.id, deriveCourseCreationBrief(conversation.messages)]]
        : [];
    }),
  ) as Record<string, CourseCreationBrief>;
}

function messageId(role: "user" | "assistant") {
  return `message-${role}-${crypto.randomUUID()}`;
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
  conversations: KeyaConversation[],
  conversationId: string,
  updater: (conversation: KeyaConversation) => KeyaConversation,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

function updateMessage(
  messages: KeyaChatMessage[],
  id: string,
  patch: Partial<KeyaChatMessage>,
) {
  return messages.map((message) =>
    message.id === id ? { ...message, ...patch } : message,
  );
}

function withSetValue<T>(values: Set<T>, value: T) {
  if (values.has(value)) return values;
  const next = new Set(values);
  next.add(value);
  return next;
}

function withoutSetValue<T>(values: Set<T>, value: T) {
  if (!values.has(value)) return values;
  const next = new Set(values);
  next.delete(value);
  return next;
}

function subscribeToWorkspaceOverlay(onChange: () => void) {
  const query = window.matchMedia("(max-width: 1199px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getWorkspaceOverlaySnapshot() {
  return window.matchMedia("(max-width: 1199px)").matches;
}

function getServerWorkspaceOverlaySnapshot() {
  return false;
}

interface ChatAppProps {
  initialConversations: KeyaConversation[];
  initialConversationId?: string;
  initialPrompt?: string;
}

type ReferenceUploadState = ReferenceAttachment & {
  file: File;
  pack?: ReferencePack;
};

type TaskTelemetry = {
  connectionStatus: CourseTaskConnectionStatus;
  taskStatus?: CourseTaskStatus;
};

const newConversationComposerKey = "__new-conversation__";

function mapStreamedCourseRun(
  state: CourseGenerationState,
  task: ActiveCourseTask,
) {
  return courseGenerationToKeyaRun(
    {
      courseId: state.courseId,
      traceId: state.traceId,
      state,
    },
    {
      id: task.runId,
      taskId: task.taskId,
      source: task.source,
      prompt: task.prompt,
      startedAt: task.runStartedAt,
    },
  );
}

function CourseTaskStreamBridge({
  task,
  onError,
  onProgress,
  onTelemetry,
  onTerminal,
}: {
  task: ActiveCourseTask;
  onError(task: ActiveCourseTask): void;
  onProgress(
    task: ActiveCourseTask,
    state: CourseGenerationState,
    taskStatus?: CourseTaskStatus,
  ): void;
  onTelemetry(task: ActiveCourseTask, telemetry: TaskTelemetry): void;
  onTerminal(task: ActiveCourseTask, state: CourseGenerationState): void;
}) {
  const callbacksRef = useRef({
    onError,
    onProgress,
    onTelemetry,
    onTerminal,
  });
  useEffect(() => {
    callbacksRef.current = {
      onError,
      onProgress,
      onTelemetry,
      onTerminal,
    };
  }, [onError, onProgress, onTelemetry, onTerminal]);

  const {
    connectionStatus,
    latestState,
    messages,
    taskStatus,
  } = useSSETask({
    taskId: task.taskId,
    enabled: true,
    onTerminal: ({ state }) => {
      callbacksRef.current.onTerminal(task, state);
    },
    onError: () => {
      callbacksRef.current.onError(task);
    },
  });
  const latestMessage = messages.at(-1);
  const resolvedTaskStatus =
    latestMessage?.type === "snapshot"
      ? (latestMessage.taskStatus ?? latestMessage.state.status)
      : taskStatus;

  useEffect(() => {
    callbacksRef.current.onTelemetry(task, {
      connectionStatus,
      taskStatus: resolvedTaskStatus,
    });
  }, [
    connectionStatus,
    resolvedTaskStatus,
    task,
  ]);

  useEffect(() => {
    if (latestState?.traceId === task.traceId) {
      callbacksRef.current.onProgress(
        task,
        latestState,
        resolvedTaskStatus,
      );
    }
  }, [latestState, resolvedTaskStatus, task]);

  return null;
}

export function ChatApp({
  initialConversations,
  initialConversationId,
  initialPrompt = "",
}: ChatAppProps) {
  const [conversations, setConversations] = useState<KeyaConversation[]>(
    () => cloneConversations(initialConversations),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return initialConversations.some(({ id }) => id === initialConversationId)
      ? (initialConversationId ?? null)
      : null;
  });
  const [draftsByConversation, setDraftsByConversation] = useState<
    Record<string, string>
  >(() => ({
    [initialConversations.some(({ id }) => id === initialConversationId)
      ? (initialConversationId ?? newConversationComposerKey)
      : newConversationComposerKey]: initialPrompt,
  }));
  const [referenceUploadsByConversation, setReferenceUploadsByConversation] =
    useState<Record<string, ReferenceUploadState[]>>({});
  const [courseBriefs, setCourseBriefs] = useState<
    Record<string, CourseCreationBrief>
  >(() => initialCourseBriefs(initialConversations));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    initialConversations.some(
      ({ courseRun, id, messages }) =>
        id === initialConversationId &&
        (Boolean(courseRun) || messages.some(({ role }) => role === "user")),
    ),
  );
  const [busyConversationIds, setBusyConversationIds] = useState<Set<string>>(
    () =>
      new Set(
        initialConversations.flatMap((conversation) =>
          conversation.taskStatus === "queued" ||
          conversation.taskStatus === "running"
            ? [conversation.id]
            : [],
        ),
      ),
  );
  const [activeCourseTasks, setActiveCourseTasks] =
    useState<ActiveCourseTaskRegistry>(() =>
      createInitialTaskRegistry(initialConversations),
    );
  const activeCourseTasksRef = useRef(activeCourseTasks);
  const [taskTelemetryByConversation, setTaskTelemetryByConversation] =
    useState<Record<string, TaskTelemetry>>({});
  const [exportingCourseId, setExportingCourseId] = useState<string | null>(null);
  const [courseExportError, setCourseExportError] = useState<string>();
  const requestControllers = useRef(
    new Map<string, Set<AbortController>>(),
  );
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

  useLayoutEffect(() => {
    activeCourseTasksRef.current = activeCourseTasks;
  }, [activeCourseTasks]);

  const isCurrentCourseTask = (task: ActiveCourseTask) => {
    const current = activeCourseTasksRef.current[task.conversationId];
    return (
      current?.taskId === task.taskId &&
      current.traceId === task.traceId
    );
  };

  const finishCourseTask = (
    task: ActiveCourseTask,
    state: CourseGenerationState,
  ) => {
    if (
      state.traceId !== task.traceId ||
      !isCurrentCourseTask(task)
    ) {
      return;
    }

    const mappedRun = mapStreamedCourseRun(state, task);
    const completedPageCount = state.pages.filter(
      ({ status }) => status === "completed",
    ).length;
    const duration = `${Math.max(
      1,
      Math.round((Date.now() - task.requestStartedAt) / 1_000),
    )}s`;
    const failure =
      state.status === "failed" || state.status === "cancelled"
        ? getCourseFailurePresentation(
            state.status,
            state.errors.at(-1),
          )
        : undefined;
    const terminalMessage =
      state.status === "completed"
        ? task.mode === "resume"
          ? `已从断点完成全部 ${completedPageCount} 页课程。`
          : `已完成「${state.intent?.topic ?? task.prompt}」的 ${state.outline?.pages.length ?? completedPageCount} 页课程。右侧学习空间可以统一预览 HTML，也可逐页检查素材与结果。`
        : failure
          ? `${failure.title}：${failure.description} 已保留 ${completedPageCount} 个完成页面。`
          : `课程生成未完成。已保留 ${completedPageCount} 个完成页面。`;

    setConversations((current) =>
      updateConversation(current, task.conversationId, (conversation) => ({
        ...conversation,
        messages: updateMessage(conversation.messages, task.assistantId, {
          content: terminalMessage,
          duration,
        }),
        courseRun: mappedRun,
        taskStatus: state.status,
      })),
    );
    void updateStoredConversation(task.conversationId, {
      updateMessage: {
        id: task.assistantId,
        content: terminalMessage,
        duration,
      },
    });
    if (selectedIdRef.current === task.conversationId) {
      setRightPanelOpen(true);
    }
    setBusyConversationIds((current) =>
      withoutSetValue(current, task.conversationId),
    );
    setActiveCourseTasks((current) =>
      removeRegisteredTask(current, task.conversationId, task.taskId),
    );
    setTaskTelemetryByConversation((current) => {
      const next = { ...current };
      delete next[task.conversationId];
      return next;
    });
  };

  const handleCourseTaskStreamError = (task: ActiveCourseTask) => {
    if (!isCurrentCourseTask(task)) return;

    setConversations((current) =>
      updateConversation(current, task.conversationId, (conversation) => ({
        ...conversation,
        taskStatus: undefined,
        messages: updateMessage(conversation.messages, task.assistantId, {
          content:
            "实时进度连接已断开。服务端任务可能仍在运行，已保存的内容不会丢失，请稍后重新打开对话查看。",
        }),
      })),
    );
    void updateStoredConversation(task.conversationId, {
      updateMessage: {
        id: task.assistantId,
        content:
          "实时进度连接已断开。服务端任务可能仍在运行，已保存的内容不会丢失，请稍后重新打开对话查看。",
      },
    });
    setBusyConversationIds((current) =>
      withoutSetValue(current, task.conversationId),
    );
    setActiveCourseTasks((current) =>
      removeRegisteredTask(current, task.conversationId, task.taskId),
    );
    setTaskTelemetryByConversation((current) => {
      const next = { ...current };
      delete next[task.conversationId];
      return next;
    });
  };

  const handleCourseTaskProgress = (
    task: ActiveCourseTask,
    state: CourseGenerationState,
    taskStatus?: CourseTaskStatus,
  ) => {
    if (
      state.traceId !== task.traceId ||
      !isCurrentCourseTask(task)
    ) {
      return;
    }
    setConversations((current) =>
      updateConversation(current, task.conversationId, (conversation) => ({
        ...conversation,
        courseRun: mapStreamedCourseRun(state, task),
        taskStatus: taskStatus ?? conversation.taskStatus,
      })),
    );
    if (taskStatus === "paused") {
      setBusyConversationIds((current) =>
        withoutSetValue(current, task.conversationId),
      );
    }
  };

  const handleTaskTelemetry = (
    task: ActiveCourseTask,
    telemetry: TaskTelemetry,
  ) => {
    if (!isCurrentCourseTask(task)) return;

    const conversationId = task.conversationId;
    setTaskTelemetryByConversation((current) => {
      const previous = current[conversationId];
      if (
        previous?.connectionStatus === telemetry.connectionStatus &&
        previous.taskStatus === telemetry.taskStatus
      ) {
        return current;
      }
      return { ...current, [conversationId]: telemetry };
    });
    if (telemetry.taskStatus === "paused") {
      setBusyConversationIds((current) =>
        withoutSetValue(current, conversationId),
      );
    }
  };

  const selectConversation = (conversationId: string | null) => {
    selectedIdRef.current = conversationId;
    setSelectedId(conversationId);
  };

  useEffect(
    () => () => {
      requestControllers.current.forEach((controllers) => {
        controllers.forEach((controller) => controller.abort());
      });
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

  const selectedConversation = useMemo(() => {
    return conversations.find(({ id }) => id === selectedId) ?? null;
  }, [conversations, selectedId]);
  const selectedRun = selectedConversation?.courseRun;
  const selectedBrief = selectedConversation
    ? courseBriefs[selectedConversation.id]
    : undefined;
  const selectedCourseQuestion = selectedBrief
    ? getNextClarificationQuestion(selectedBrief)
    : undefined;
  const selectedTaskTelemetry = selectedConversation
    ? {
        connectionStatus:
          taskTelemetryByConversation[selectedConversation.id]
            ?.connectionStatus ?? "idle",
        taskStatus:
          taskTelemetryByConversation[selectedConversation.id]?.taskStatus ??
          selectedConversation.taskStatus,
      }
    : undefined;
  const selectedComposerTaskStatus =
    selectedTaskTelemetry?.taskStatus === "queued" ||
    selectedTaskTelemetry?.taskStatus === "running" ||
    selectedTaskTelemetry?.taskStatus === "paused"
      ? selectedTaskTelemetry.taskStatus
      : undefined;
  const composerKey = selectedId ?? newConversationComposerKey;
  const draft = draftsByConversation[composerKey] ?? "";
  const referenceUploads =
    referenceUploadsByConversation[composerKey] ?? [];
  const busy = selectedId ? busyConversationIds.has(selectedId) : false;

  const setConversationBusy = (conversationId: string, value: boolean) => {
    setBusyConversationIds((current) =>
      value
        ? withSetValue(current, conversationId)
        : withoutSetValue(current, conversationId),
    );
  };

  const setDraft = (value: string) => {
    setDraftsByConversation((current) => ({
      ...current,
      [composerKey]: value,
    }));
  };

  const setReferenceUploads = (
    updater:
      | ReferenceUploadState[]
      | ((current: ReferenceUploadState[]) => ReferenceUploadState[]),
    key = composerKey,
  ) => {
    setReferenceUploadsByConversation((current) => {
      const previous = current[key] ?? [];
      const next =
        typeof updater === "function" ? updater(previous) : updater;
      return { ...current, [key]: next };
    });
  };

  const createController = (conversationId: string) => {
    const controller = new AbortController();
    const controllers =
      requestControllers.current.get(conversationId) ??
      new Set<AbortController>();
    controllers.add(controller);
    requestControllers.current.set(conversationId, controllers);
    return controller;
  };

  const releaseController = (
    conversationId: string,
    controller: AbortController,
  ) => {
    const controllers = requestControllers.current.get(conversationId);
    controllers?.delete(controller);
    if (controllers?.size === 0) {
      requestControllers.current.delete(conversationId);
    }
  };

  const handlePauseCourse = async () => {
    const conversationId = selectedIdRef.current;
    const task = conversationId
      ? activeCourseTasksRef.current[conversationId]
      : undefined;
    if (!conversationId || !task) {
      return;
    }

    setConversationBusy(conversationId, true);
    const controller = createController(conversationId);
    let shouldRemainBusy = true;
    try {
      const response = await pauseCourseTask(task.taskId, {
        signal: controller.signal,
        traceId: task.traceId,
      });
      shouldRemainBusy =
        response.status === "queued" || response.status === "running";
      setConversations((current) =>
        updateConversationTaskStatus(
          current,
          conversationId,
          response.status,
        ),
      );
      setTaskTelemetryByConversation((current) => ({
        ...current,
        [conversationId]: {
          connectionStatus: "closed",
          taskStatus: response.status,
        },
      }));
    } catch {
      const publicMessage = "课程任务暂时无法暂停，请稍后再试。";
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, task.assistantId, {
            content: publicMessage,
          }),
        })),
      );
      void updateStoredConversation(conversationId, {
        updateMessage: {
          id: task.assistantId,
          content: publicMessage,
        },
      });
    } finally {
      releaseController(conversationId, controller);
      setConversationBusy(
        conversationId,
        shouldRemainBusy && isCurrentCourseTask(task),
      );
    }
  };

  const handleResumePausedCourse = async () => {
    const conversationId = selectedIdRef.current;
    const task = conversationId
      ? activeCourseTasksRef.current[conversationId]
      : undefined;
    if (
      !conversationId ||
      !task ||
      busyConversationIds.has(conversationId)
    ) {
      return;
    }

    setConversationBusy(conversationId, true);
    const controller = createController(conversationId);
    let resumed = false;
    try {
      const response = await resumeCourseTask(task.taskId, {
        signal: controller.signal,
        traceId: task.traceId,
      });
      setActiveCourseTasks((current) => ({
        ...current,
        [conversationId]: {
          ...task,
          traceId: response.traceId,
          source: response.source,
          requestStartedAt: Date.now(),
        },
      }));
      setConversations((current) =>
        updateConversation(
          updateConversationTaskStatus(
            current,
            conversationId,
            response.status,
          ),
          conversationId,
          (conversation) => ({
            ...conversation,
            courseRun: conversation.courseRun
              ? {
                  ...conversation.courseRun,
                  traceId: response.traceId,
                  source: response.source,
                }
              : conversation.courseRun,
          }),
        ),
      );
      setTaskTelemetryByConversation((current) => ({
        ...current,
        [conversationId]: {
          connectionStatus: "connecting",
          taskStatus: response.status,
        },
      }));
      resumed = true;
    } catch {
      const publicMessage = "课程任务暂时无法继续，请稍后再试。";
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          messages: updateMessage(conversation.messages, task.assistantId, {
            content: publicMessage,
          }),
        })),
      );
      void updateStoredConversation(conversationId, {
        updateMessage: {
          id: task.assistantId,
          content: publicMessage,
        },
      });
    } finally {
      releaseController(conversationId, controller);
      if (!resumed) {
        setConversationBusy(conversationId, false);
      }
    }
  };

  const handleNewConversation = () => {
    selectConversation(null);
    setRightPanelOpen(false);
  };

  const handleSelectConversation = (conversationId: string) => {
    selectConversation(conversationId);
    setRightPanelOpen(
      Boolean(
        conversations.find(({ id }) => id === conversationId)?.courseRun ||
          courseBriefs[conversationId],
      ),
    );
  };

  const handleTogglePinned = (
    conversationId: string,
    pinned: boolean,
  ) => {
    const previous = conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    if (!previous || previous.pinned === pinned) return;

    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        pinned,
      })),
    );
    const controller = createController(conversationId);
    void updateStoredConversation(
      conversationId,
      { pinned },
      controller.signal,
    )
      .catch(() => {
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            pinned: previous.pinned,
          })),
        );
      })
      .finally(() => releaseController(conversationId, controller));
  };

  const handleRenameConversation = (
    conversationId: string,
    title: string,
  ) => {
    const normalizedTitle = title.trim();
    const previous = conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    if (
      !previous ||
      !normalizedTitle ||
      previous.title === normalizedTitle
    ) {
      return;
    }

    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        title: normalizedTitle,
      })),
    );
    const controller = createController(conversationId);
    void updateStoredConversation(
      conversationId,
      { title: normalizedTitle },
      controller.signal,
    )
      .catch(() => {
        setConversations((current) =>
          updateConversation(current, conversationId, (conversation) => ({
            ...conversation,
            title: previous.title,
          })),
        );
      })
      .finally(() => releaseController(conversationId, controller));
  };

  const handleDeleteConversation = async (conversationId: string) => {
    const conversation = conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    if (!conversation) return;

    const task = activeCourseTasksRef.current[conversationId];
    const taskId = task?.taskId ?? conversation.courseRun?.taskId;
    const hasNonTerminalTask =
      conversation.taskStatus === "queued" ||
      conversation.taskStatus === "running" ||
      conversation.taskStatus === "paused";
    if (hasNonTerminalTask && !taskId) {
      window.alert("课程任务正在启动，请稍后再删除这个对话。");
      return;
    }
    if (!window.confirm(`确认删除对话“${conversation.title}”吗？`)) return;

    requestControllers.current
      .get(conversationId)
      ?.forEach((controller) => controller.abort());
    requestControllers.current.delete(conversationId);
    setConversationBusy(conversationId, true);

    const controller = createController(conversationId);

    try {
      if (hasNonTerminalTask && taskId) {
        await cancelCourseTask(taskId, {
          signal: controller.signal,
          traceId: task?.traceId ?? conversation.courseRun?.traceId,
        });
      }
      await deleteStoredConversation(conversationId, controller.signal);

      const deletedIndex = conversations.findIndex(
        (candidate) => candidate.id === conversationId,
      );
      const remaining = conversations.filter(
        (candidate) => candidate.id !== conversationId,
      );
      const nextConversation =
        remaining[deletedIndex] ?? remaining[deletedIndex - 1] ?? null;

      setConversations((current) =>
        current.filter((candidate) => candidate.id !== conversationId),
      );
      setActiveCourseTasks((current) =>
        removeRegisteredTask(current, conversationId),
      );
      setTaskTelemetryByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setCourseBriefs((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setDraftsByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setReferenceUploadsByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });

      if (selectedIdRef.current === conversationId) {
        selectConversation(nextConversation?.id ?? null);
        setRightPanelOpen(
          Boolean(
            nextConversation?.courseRun ||
              (nextConversation && courseBriefs[nextConversation.id]),
          ),
        );
      }
    } catch {
      window.alert("对话删除失败，请稍后再试。");
    } finally {
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
    }
  };

  const handleSuggestion = (value: string) => {
    setDraft(value);
  };

  const appendCourseBriefAnswer = async (
    conversationId: string,
    answer: string,
    questionId?: ClarificationQuestionId,
  ) => {
    const currentBrief = courseBriefs[conversationId];
    if (!currentBrief || busyConversationIds.has(conversationId)) return;

    const userMessage: KeyaChatMessage = {
      id: messageId("user"),
      role: "user",
      content: answer,
      createdAt: new Date().toISOString(),
    };
    const updatedBrief = applyCourseCreationAnswer(
      currentBrief,
      answer,
      questionId,
    );

    setCourseBriefs((current) => ({
      ...current,
      [conversationId]: updatedBrief,
    }));
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, userMessage],
      })),
    );
    setDraftsByConversation((current) => ({
      ...current,
      [conversationId]: "",
    }));

    const controller = createController(conversationId);
    try {
      await updateStoredConversation(
        conversationId,
        { appendMessages: [userMessage] },
        controller.signal,
      );
    } finally {
      releaseController(conversationId, controller);
    }
  };

  const startCourseGeneration = async (
    conversationId: string,
    brief: CourseCreationBrief,
  ) => {
    if (
      busyConversationIds.has(conversationId) ||
      getNextClarificationQuestion(brief)
    ) {
      return;
    }

    const conversationUploads =
      referenceUploadsByConversation[conversationId] ?? [];
    const referencePacks = conversationUploads.flatMap(({ pack }) =>
      pack ? [pack] : [],
    );
    const taskPrompt = buildCourseTaskPrompt(brief);
    const pageCount = resolveCourseSectionCount(brief);
    const startedAt = Date.now();
    const assistantId = messageId("assistant");
    const traceId = crypto.randomUUID();
    const courseId = `course-${crypto.randomUUID()}`;
    const assistantMessage: KeyaChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "课程方向已确认，正在生成内容。",
      createdAt: new Date(startedAt).toISOString(),
    };
    const courseRun: KeyaCourseRun = {
      id: `run-${startedAt}`,
      courseId,
      prompt: taskPrompt,
      traceId,
      source: "langgraph",
      startedAt,
      planner: { status: "running", events: [] },
      design: { status: "idle", events: [] },
      pageWrites: {},
      pageAssets: {},
      pageHtml: {},
      pageQa: {},
    };

    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        title: brief.topic || conversation.title,
        messages: [...conversation.messages, assistantMessage],
        courseRun,
        taskStatus: "queued",
      })),
    );
    setConversationBusy(conversationId, true);
    setDraftsByConversation((current) => ({
      ...current,
      [conversationId]: "",
    }));

    const controller = createController(conversationId);
    try {
      await saveConversation(
        {
          id: conversationId,
          title: brief.topic || conversationTitle(brief.originalRequest),
          messages: [assistantMessage],
        },
        controller.signal,
      );
      const task = await createCourseTask(
        {
          courseId,
          userPrompt: taskPrompt,
          referencePacks,
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
                source: task.source,
              }
            : conversation.courseRun,
        })),
      );
      await updateStoredConversation(
        conversationId,
        {
          courseId: task.courseId,
          taskId: task.taskId,
        },
        controller.signal,
      );
      setActiveCourseTasks((current) => ({
        ...current,
        [conversationId]: {
          taskId: task.taskId,
          traceId: task.traceId,
          conversationId,
          assistantId,
          runId: courseRun.id,
          prompt: taskPrompt,
          runStartedAt: startedAt,
          requestStartedAt: startedAt,
          mode: "create",
          source: task.source,
        },
      }));
      setConversations((current) =>
        updateConversationTaskStatus(
          current,
          conversationId,
          task.status,
        ),
      );
      setReferenceUploads([], conversationId);
      if (selectedIdRef.current === conversationId) {
        setRightPanelOpen(true);
      }
    } catch (error) {
      const message = getErrorMessage(error, "课程生成请求失败。");
      const publicMessage =
        "课程生成请求失败。请检查网络或模型服务配置后重试。";
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          taskStatus: undefined,
          messages: updateMessage(conversation.messages, assistantId, {
            content: publicMessage,
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
      void updateStoredConversation(conversationId, {
        updateMessage: {
          id: assistantId,
          content: publicMessage,
        },
      });
      setConversationBusy(conversationId, false);
    } finally {
      releaseController(conversationId, controller);
    }
  };

  const handleAnswerCourseQuestion = (
    answer: string,
    questionId?: ClarificationQuestionId,
  ) => {
    if (!selectedConversation || selectedRun) return;
    void appendCourseBriefAnswer(
      selectedConversation.id,
      answer,
      questionId,
    );
  };

  const handleConfirmCourse = () => {
    if (!selectedConversation || !selectedBrief || selectedRun) return;
    void startCourseGeneration(selectedConversation.id, selectedBrief);
  };

  const handleSubmit = async (value: string) => {
    const text = value.trim();
    if (
      !text ||
      busy ||
      referenceUploads.some(({ status }) => status !== "ready")
    ) {
      return;
    }

    if (selectedConversation && selectedBrief && !selectedRun) {
      if (
        !selectedCourseQuestion &&
        /^(?:开始|开始生成|生成课程|就这样|确认)$/u.test(text)
      ) {
        await startCourseGeneration(selectedConversation.id, selectedBrief);
        return;
      }
      await appendCourseBriefAnswer(
        selectedConversation.id,
        text,
        selectedCourseQuestion?.id,
      );
      return;
    }

    const courseBrief = createCourseCreationBrief(text);
    const conversationId = `conversation-${crypto.randomUUID()}`;
    const userMessage: KeyaChatMessage = {
      id: messageId("user"),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const storedTitle =
      courseBrief.topic || conversationTitle(courseBrief.originalRequest);
    const controller = createController(conversationId);
    const pendingUploads =
      referenceUploadsByConversation[newConversationComposerKey] ?? [];

    try {
      await saveConversation(
        {
          id: conversationId,
          title: storedTitle,
          messages: [userMessage],
        },
        controller.signal,
      );
      setConversations((current) => [
        ...current,
        {
          id: conversationId,
          title: storedTitle,
          messages: [userMessage],
        },
      ]);
      setCourseBriefs((current) => ({
        ...current,
        [conversationId]: courseBrief,
      }));
      setDraftsByConversation((current) => ({
        ...current,
        [newConversationComposerKey]: "",
        [conversationId]: "",
      }));
      setReferenceUploadsByConversation((current) => ({
        ...current,
        [newConversationComposerKey]: [],
        [conversationId]: pendingUploads,
      }));
      selectConversation(conversationId);
      setRightPanelOpen(true);
    } finally {
      releaseController(conversationId, controller);
    }
  };

  const handleResumeCourse = async () => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const courseId = run?.courseId;
    if (
      !conversationId ||
      !run ||
      !courseId ||
      busyConversationIds.has(conversationId)
    ) {
      return;
    }

    const assistantId = messageId("assistant");
    const startedAt = Date.now();
    const resumeMessage: KeyaChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在从服务端检查点继续生成未完成页面…",
      createdAt: new Date(startedAt).toISOString(),
    };
    const knownPageCount = run.planner.data?.intent.courseLength;
    const previousTaskStatus = selectedConversation.taskStatus;
    const pageCount =
      Number.isSafeInteger(knownPageCount) && (knownPageCount ?? 0) > 0
        ? knownPageCount
        : undefined;
    setConversationBusy(conversationId, true);
    setConversations((current) =>
      updateConversation(current, conversationId, (conversation) => ({
        ...conversation,
        taskStatus: "queued",
        messages: [
          ...conversation.messages,
          resumeMessage,
        ],
      })),
    );
    const controller = createController(conversationId);
    const traceId = crypto.randomUUID();

    try {
      await saveConversation(
        {
          id: conversationId,
          title: selectedConversation.title,
          courseId,
          taskId: run.taskId,
          messages: [...selectedConversation.messages, resumeMessage],
        },
        controller.signal,
      );
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
                source: task.source,
              }
            : conversation.courseRun,
        })),
      );
      await updateStoredConversation(
        conversationId,
        { courseId: task.courseId, taskId: task.taskId },
        controller.signal,
      );
      setActiveCourseTasks((current) => ({
        ...current,
        [conversationId]: {
          taskId: task.taskId,
          traceId: task.traceId,
          conversationId,
          assistantId,
          runId: run.id,
          prompt: run.prompt,
          runStartedAt: run.startedAt,
          requestStartedAt: startedAt,
          mode: "resume",
          source: task.source,
        },
      }));
      setConversations((current) =>
        updateConversationTaskStatus(
          current,
          conversationId,
          task.status,
        ),
      );
    } catch {
      const publicMessage =
        "没有成功重新开始课程生成，请检查网络或模型服务配置后再试。";
      setConversations((current) =>
        updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          taskStatus: previousTaskStatus,
          messages: updateMessage(conversation.messages, assistantId, {
            content: publicMessage,
          }),
        })),
      );
      void updateStoredConversation(conversationId, {
        updateMessage: {
          id: assistantId,
          content: publicMessage,
        },
      });
      setConversationBusy(conversationId, false);
    } finally {
      releaseController(conversationId, controller);
    }
  };

  const handleGenerateDesign = async () => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const planner = run?.planner.data;
    const outline = planner?.state.outline;

    if (!conversationId || !run || !planner || !outline || busy) return;

    setConversationBusy(conversationId, true);
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
    const controller = createController(conversationId);

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
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
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

    setConversationBusy(conversationId, true);
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
    const controller = createController(conversationId);

    try {
      const result = await writeCoursePage(
        {
          intent: planner.intent,
          page,
          brief,
          referencePacks: run.generation?.referencePacks ?? [],
        },
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
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
    }
  };

  const handleGenerateAssets = async (pageId: string) => {
    const conversationId = selectedConversation?.id;
    const run = selectedConversation?.courseRun;
    const content = run?.pageWrites[pageId]?.data?.state.content;
    const visualBrief = run?.design.data?.state.briefs?.visual;

    if (!conversationId || !run || !content || !visualBrief || busy) return;

    setConversationBusy(conversationId, true);
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
    const controller = createController(conversationId);

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
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
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

    setConversationBusy(conversationId, true);
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
    const controller = createController(conversationId);

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
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
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

    setConversationBusy(conversationId, true);
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
    const controller = createController(conversationId);

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
      releaseController(conversationId, controller);
      setConversationBusy(conversationId, false);
    }
  };

  const handleOpenHtmlPreview = async (pageId: string) => {
    const page = selectedRun?.planner.data?.state.outline?.pages.find(
      ({ id }) => id === pageId,
    );
    const html = selectedRun?.pageHtml[pageId]?.data?.state.htmlOutput?.html;
    const qualityReport = selectedRun?.pageQa[pageId]?.data?.state.report;
    if (!page || !html) return;

    try {
      const preview = await saveGeneratedHtmlPreview({
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
    } catch (error) {
      setCourseExportError(getErrorMessage(error, "独立预览保存失败。"));
    }
  };

  const handleOpenCoursePlayer = () => {
    const courseId = selectedRun?.courseId;
    if (!courseId) return;
    window.open(
      `/course/${encodeURIComponent(courseId)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleExportCourse = async () => {
    const courseId = selectedRun?.courseId;
    if (!courseId || exportingCourseId) return;
    setCourseExportError(undefined);
    setExportingCourseId(courseId);
    try {
      await downloadCourseArchive(courseId);
    } catch (error) {
      setCourseExportError(getErrorMessage(error, "课程导出失败。"));
    } finally {
      setExportingCourseId(null);
    }
  };

  const parseUpload = (
    upload: ReferenceUploadState,
    key: string,
  ) => {
    const controller = createController(key);
    setReferenceUploads((current) =>
      current.map((item) =>
        item.id === upload.id
          ? { ...item, status: "uploading", error: undefined, pack: undefined }
          : item,
      ),
      key,
    );

    void parseReferenceFile(upload.file, {
      signal: controller.signal,
      traceId: crypto.randomUUID(),
    })
      .then((pack) => {
        setReferenceUploads(
          (current) =>
            current.map((item) =>
              item.id === upload.id
                ? { ...item, status: "ready", pack, error: undefined }
                : item,
            ),
          key,
        );
      })
      .catch((error) => {
        setReferenceUploads(
          (current) =>
            current.map((item) =>
              item.id === upload.id
                ? {
                    ...item,
                    status: "error",
                    error: getErrorMessage(error, "资料解析失败。"),
                    pack: undefined,
                  }
                : item,
            ),
          key,
        );
      })
      .finally(() => releaseController(key, controller));
  };

  const handleFilesSelected = (files: File[]) => {
    if (busy) return;
    const remaining = Math.max(0, 3 - referenceUploads.length);
    const uploads = files.slice(0, remaining).map((file) => ({
      id: `reference-${crypto.randomUUID()}`,
      name: file.name,
      status: "uploading" as const,
      file,
    }));
    if (uploads.length === 0) return;

    setReferenceUploads((current) => [...current, ...uploads], composerKey);
    uploads.forEach((upload) => parseUpload(upload, composerKey));
  };

  const handleRetryReference = (id: string) => {
    const upload = referenceUploads.find((item) => item.id === id);
    if (upload && !busy) parseUpload(upload, composerKey);
  };

  return (
    <main className="fixed inset-0 flex overflow-hidden bg-[#fff9ee] text-[#2d332b]">
      {Object.values(activeCourseTasks).map((task) => {
        const taskStatus = conversations.find(
          (conversation) => conversation.id === task.conversationId,
        )?.taskStatus;
        if (taskStatus === "paused") return null;

        return (
          <CourseTaskStreamBridge
            key={`${task.taskId}:${task.traceId}`}
            onError={handleCourseTaskStreamError}
            onProgress={handleCourseTaskProgress}
            onTelemetry={handleTaskTelemetry}
            onTerminal={finishCourseTask}
            task={task}
          />
        );
      })}
      <ChatSidebar
        collapsed={collapsed}
        conversations={conversations}
        inert={workspaceIsModal}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onDeleteConversation={handleDeleteConversation}
        onNewConversation={handleNewConversation}
        onRenameConversation={handleRenameConversation}
        onSelectConversation={handleSelectConversation}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onTogglePinned={handleTogglePinned}
        selectedConversationId={selectedId}
      />

      <section className="relative flex min-w-0 flex-1 overflow-hidden">
        <Button
          aria-label="打开对话侧栏"
          className="absolute top-3 left-3 z-20 flex size-10 items-center justify-center rounded-full border border-[#e8dfd0] bg-[#fffcf5] p-0 text-[#3f4a40] shadow-sm hover:bg-[#fffcf5] focus-visible:outline-2 focus-visible:outline-[#397a52] md:hidden"
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
            courseBrief={selectedBrief}
            courseQuestion={selectedCourseQuestion}
            onAnswerCourseQuestion={handleAnswerCourseQuestion}
            onConfirmCourse={handleConfirmCourse}
            onOpenCoursePlayer={handleOpenCoursePlayer}
            onResumeCourse={handleResumeCourse}
            taskStatus={selectedTaskTelemetry?.taskStatus}
          />
          <ChatComposer
            attachments={referenceUploads.map(
              ({ error, id, name, pack, status }) => ({
                error,
                id,
                keyFacts: pack?.keyFacts.map(({ text }) => text),
                name,
                status,
                summary: pack?.summary,
              }),
            )}
            busy={busy}
            compact={rightPanelOpen}
            contextLabel={
              selectedRun ? "课程" : selectedConversation ? "演示" : undefined
            }
            draft={draft}
            onDraftChange={setDraft}
            onFilesSelected={handleFilesSelected}
            onPause={handlePauseCourse}
            onRemoveAttachment={(id) =>
              setReferenceUploads(
                (current) => current.filter((item) => item.id !== id),
                composerKey,
              )
            }
            onResume={handleResumePausedCourse}
            onRetryAttachment={handleRetryReference}
            onSelectSuggestion={handleSuggestion}
            onSubmit={handleSubmit}
            showSuggestions={selectedConversation === null}
            taskStatus={selectedComposerTaskStatus}
          />
        </div>

        {rightPanelOpen ? (
          <Button
            aria-label="关闭学习空间"
            className="absolute inset-0 z-10 h-auto w-auto rounded-none border-0 bg-[#2d332b]/10 p-0 hover:bg-[#2d332b]/10 lg:hidden"
            onClick={() => setRightPanelOpen(false)}
            type="button"
            variant="ghost"
          />
        ) : null}

        <aside
          aria-hidden={!rightPanelOpen}
          aria-label="学习空间"
          aria-modal={workspaceIsModal ? true : undefined}
          className={`min-h-0 shrink-0 overflow-hidden border-l border-border bg-card transition-[width,visibility] duration-300 max-[1199px]:absolute max-[1199px]:inset-y-0 max-[1199px]:right-0 max-[1199px]:z-20 ${
            rightPanelOpen
              ? "visible w-[410px] max-md:w-full"
              : "invisible w-0 border-l-0"
          }`}
          id="course-learning-workspace"
          inert={!rightPanelOpen ? true : undefined}
          ref={workspaceRef}
          role={workspaceIsModal ? "dialog" : undefined}
          tabIndex={workspaceIsModal ? -1 : undefined}
        >
          <div className="h-full min-h-0 w-[410px] max-w-full overflow-hidden max-md:w-screen">
            <CourseWorkspacePanel
              brief={selectedBrief}
              busy={busy}
              exportError={courseExportError}
              exporting={exportingCourseId === selectedRun?.courseId}
              onExportCourse={handleExportCourse}
              onGenerateDesign={handleGenerateDesign}
              onGenerateAssets={handleGenerateAssets}
              onGenerateHtml={handleGenerateHtml}
              onEvaluatePage={handleEvaluatePage}
              onGeneratePage={handleGeneratePage}
              onOpenHtmlPreview={handleOpenHtmlPreview}
              onOpenCoursePlayer={handleOpenCoursePlayer}
              onResumeCourse={handleResumeCourse}
              run={selectedRun}
              taskStatus={selectedTaskTelemetry?.taskStatus}
            />
          </div>
        </aside>

        <Button
          aria-controls="course-learning-workspace"
          aria-expanded={rightPanelOpen}
          aria-label={rightPanelOpen ? "收起右侧栏" : "展开右侧栏"}
          className="absolute top-[38px] right-0 z-30 flex h-[35px] w-[27px] items-center justify-center rounded-l-[10px] border border-r-0 border-[#e8dfd0] bg-[#fffcf5] p-0 text-[#3f4a40] hover:bg-[#fffcf5] focus-visible:outline-2 focus-visible:outline-[#397a52]"
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
