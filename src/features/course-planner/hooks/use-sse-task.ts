"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CourseGenerationStateSchema,
  CourseTaskStreamMessageSchema,
  type CourseGenerationState,
  type CourseTaskRuntimeSource,
  type CourseTaskStatus,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

export type CourseTaskConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export type CourseTaskEventSource = {
  readonly readyState: number;
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
};

export type CourseTaskEventSourceFactory = (
  url: string,
) => CourseTaskEventSource;

export type CourseTaskStreamState = {
  connectionStatus: CourseTaskConnectionStatus;
  taskStatus?: CourseTaskStatus;
  source?: CourseTaskRuntimeSource;
  messages: CourseTaskStreamMessage[];
  latestState?: CourseGenerationState;
  error?: Error;
};

type SnapshotMessage = Extract<
  CourseTaskStreamMessage,
  { type: "snapshot" }
>;
type EventMessage = Extract<CourseTaskStreamMessage, { type: "event" }>;
type TerminalMessage = Extract<
  CourseTaskStreamMessage,
  { type: "terminal" }
>;

export type UseSSETaskOptions = {
  taskId: string | null;
  enabled?: boolean;
  eventSourceFactory?: CourseTaskEventSourceFactory;
  onMessage?: (message: CourseTaskStreamMessage) => void;
  onSnapshot?: (message: SnapshotMessage) => void;
  onEvent?: (message: EventMessage) => void;
  onTerminal?: (message: TerminalMessage) => void;
  onError?: (error: Error) => void;
};

export type UseSSETaskResult = CourseTaskStreamState & {
  disconnect: () => void;
};

type CourseTaskStreamAction =
  | { type: "reset"; enabled: boolean }
  | { type: "open" }
  | { type: "reconnecting" }
  | { type: "message"; message: CourseTaskStreamMessage }
  | { type: "error"; error: Error }
  | { type: "disconnect" };

const initialState: CourseTaskStreamState = {
  connectionStatus: "idle",
  messages: [],
};

const streamEventNames = ["message", "snapshot", "event", "terminal"];

/** 解析并校验服务端公开的 SSE 消息，原生 MessageEvent 不会越过此边界。 */
export function parseCourseTaskStreamMessage(
  value: string,
): CourseTaskStreamMessage {
  let payload: unknown;

  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("课程任务事件不是有效的 JSON。");
  }

  const parsed = CourseTaskStreamMessageSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(
      `课程任务事件不符合协议：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

/** 纯状态转换，供 Hook 和 Node 环境下的协议测试共同使用。 */
export function reduceCourseTaskStreamState(
  state: CourseTaskStreamState,
  action: CourseTaskStreamAction,
): CourseTaskStreamState {
  switch (action.type) {
    case "reset":
      return action.enabled
        ? {
            connectionStatus: "connecting",
            taskStatus: "queued",
            messages: [],
          }
        : initialState;
    case "open":
      return {
        ...state,
        connectionStatus: "open",
        error: undefined,
      };
    case "reconnecting":
      return {
        ...state,
        connectionStatus: "reconnecting",
      };
    case "disconnect":
      return {
        ...state,
        connectionStatus: "closed",
      };
    case "error":
      return {
        ...state,
        connectionStatus: "closed",
        error: action.error,
      };
    case "message":
      return applyStreamMessage(state, action.message);
  }
}

/** 协议错误是致命连接错误；网络 error 事件则交给 EventSource 自动重连。 */
export function shouldCloseCourseTaskStream(
  previousState: CourseTaskStreamState,
  nextState: CourseTaskStreamState,
) {
  return Boolean(
    nextState.error && nextState.error !== previousState.error,
  );
}

/** 将 EventSource 生命周期保持在 Controller 层，展示组件只消费类型化状态。 */
export function useSSETask({
  taskId,
  enabled = true,
  eventSourceFactory,
  onMessage,
  onSnapshot,
  onEvent,
  onTerminal,
  onError,
}: UseSSETaskOptions): UseSSETaskResult {
  const [state, setState] = useState<CourseTaskStreamState>(initialState);
  const stateRef = useRef(state);
  const sourceRef = useRef<CourseTaskEventSource | null>(null);
  const factoryRef = useRef<CourseTaskEventSourceFactory>(
    eventSourceFactory ?? defaultEventSourceFactory,
  );
  const callbacksRef = useRef({
    onMessage,
    onSnapshot,
    onEvent,
    onTerminal,
    onError,
  });

  useEffect(() => {
    factoryRef.current = eventSourceFactory ?? defaultEventSourceFactory;
  }, [eventSourceFactory]);

  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onSnapshot,
      onEvent,
      onTerminal,
      onError,
    };
  }, [onError, onEvent, onMessage, onSnapshot, onTerminal]);

  const update = useCallback((action: CourseTaskStreamAction) => {
    const nextState = reduceCourseTaskStreamState(stateRef.current, action);
    stateRef.current = nextState;
    setState(nextState);
    return nextState;
  }, []);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    update({ type: "disconnect" });
  }, [update]);

  useEffect(() => {
    sourceRef.current?.close();
    sourceRef.current = null;

    if (!enabled || !taskId) {
      update({ type: "reset", enabled: false });
      return;
    }

    update({ type: "reset", enabled: true });

    let source: CourseTaskEventSource;

    try {
      source = factoryRef.current(
        `/api/courses/tasks/${encodeURIComponent(taskId)}/events`,
      );
    } catch (error) {
      const fatalError = toError(error);
      logCourseTaskStreamError(taskId, "event-source:create-error", fatalError);
      update({ type: "error", error: fatalError });
      callbacksRef.current.onError?.(fatalError);
      return;
    }

    sourceRef.current = source;

    const isCurrentSource = () => sourceRef.current === source;
    const handleOpen = () => {
      if (isCurrentSource()) {
        update({ type: "open" });
      }
    };
    const handleError = () => {
      if (isCurrentSource()) {
        logCourseTaskStreamError(
          taskId,
          "event-source:connection-error",
          new Error("课程任务 EventSource 连接异常，浏览器将尝试自动重连。"),
        );
        update({ type: "reconnecting" });
      }
    };
    const handleMessage = (event: MessageEvent<string>) => {
      if (!isCurrentSource()) {
        return;
      }

      let message: CourseTaskStreamMessage;

      try {
        message = parseCourseTaskStreamMessage(event.data);
      } catch (error) {
        const fatalError = toError(error);
        logCourseTaskStreamError(
          taskId,
          "event-source:protocol-error",
          fatalError,
        );
        source.close();
        sourceRef.current = null;
        update({ type: "error", error: fatalError });
        callbacksRef.current.onError?.(fatalError);
        return;
      }

      if (message.taskId !== taskId) {
        const fatalError = new Error("课程任务事件引用了其他 taskId。");
        logCourseTaskStreamError(
          taskId,
          "event-source:task-mismatch",
          fatalError,
        );
        source.close();
        sourceRef.current = null;
        update({
          type: "error",
          error: fatalError,
        });
        callbacksRef.current.onError?.(fatalError);
        return;
      }

      const previousState = stateRef.current;
      const nextState = update({ type: "message", message });

      // 重连可能重放最后一个事件；被 reducer 去重的消息不再触发回调。
      if (nextState === previousState) {
        return;
      }

      if (shouldCloseCourseTaskStream(previousState, nextState)) {
        logCourseTaskStreamError(
          taskId,
          "event-source:state-error",
          nextState.error!,
        );
        source.close();
        sourceRef.current = null;
        callbacksRef.current.onError?.(nextState.error!);
        return;
      }

      const callbacks = callbacksRef.current;
      callbacks.onMessage?.(message);

      if (message.type === "snapshot") {
        callbacks.onSnapshot?.(message);
      } else if (message.type === "event") {
        callbacks.onEvent?.(message);
      } else {
        callbacks.onTerminal?.(message);
        source.close();
        sourceRef.current = null;
      }
    };

    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    streamEventNames.forEach((eventName) => {
      source.addEventListener(eventName, handleMessage);
    });

    return () => {
      source.removeEventListener("open", handleOpen);
      source.removeEventListener("error", handleError);
      streamEventNames.forEach((eventName) => {
        source.removeEventListener(eventName, handleMessage);
      });
      source.close();

      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
    };
  }, [enabled, taskId, update]);

  return {
    ...state,
    disconnect,
  };
}

function applyStreamMessage(
  state: CourseTaskStreamState,
  message: CourseTaskStreamMessage,
): CourseTaskStreamState {
  if (state.source && message.source !== state.source) {
    return {
      ...state,
      connectionStatus: "closed",
      error: new Error("课程任务流在运行期间切换了执行来源。"),
    };
  }

  if (
    state.latestState &&
    message.courseId !== state.latestState.courseId
  ) {
    return {
      ...state,
      connectionStatus: "closed",
      error: new Error("课程任务事件引用了其他 courseId。"),
    };
  }

  if (message.type === "snapshot") {
    const currentSequence =
      state.latestState?.events.at(-1)?.sequence ?? -1;
    const incomingSequence = message.state.events.at(-1)?.sequence ?? -1;

    // Route 初始化时会先订阅实时总线、再读取磁盘快照。若磁盘已经
    // 前进到更新版本，缓冲区里的旧 snapshot 不能让客户端状态回退。
    if (incomingSequence < currentSequence) {
      return state;
    }

    return {
      connectionStatus: "open",
      taskStatus: message.taskStatus ?? message.state.status,
      source: message.source,
      messages: [...state.messages, message],
      latestState: message.state,
    };
  }

  if (message.type === "terminal") {
    return {
      connectionStatus: "closed",
      taskStatus: message.status,
      source: message.source,
      messages: [...state.messages, message],
      latestState: message.state,
    };
  }

  const latestState = state.latestState;

  if (!latestState) {
    return {
      ...state,
      connectionStatus: "closed",
      error: new Error("课程任务在 snapshot 之前发送了增量事件。"),
    };
  }

  const lastSequence = latestState.events.at(-1)?.sequence ?? 0;

  if (message.event.sequence <= lastSequence) {
    return state;
  }

  if (message.event.sequence !== lastSequence + 1) {
    return {
      ...state,
      connectionStatus: "closed",
      error: new Error(
        `课程任务事件序号不连续：期望 ${lastSequence + 1}，收到 ${message.event.sequence}。`,
      ),
    };
  }

  const parsedState = CourseGenerationStateSchema.safeParse({
    ...latestState,
    events: [...latestState.events, message.event],
    updatedAt: message.event.timestamp,
  });

  if (!parsedState.success) {
    return {
      ...state,
      connectionStatus: "closed",
      error: new Error(
        `课程任务事件无法合并到当前状态：${parsedState.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "root"}: ${issue.message}`,
          )
          .join("; ")}`,
      ),
    };
  }

  return {
    connectionStatus: "open",
    taskStatus: "running",
    source: message.source,
    messages: [...state.messages, message],
    latestState: parsedState.data,
  };
}

function defaultEventSourceFactory(url: string): CourseTaskEventSource {
  return new EventSource(url);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function logCourseTaskStreamError(
  taskId: string,
  event: string,
  error: Error,
) {
  console.error("[course-task-client]", {
    event,
    taskId,
    errorName: error.name,
    errorMessage: error.message,
    errorStack: error.stack,
  });
}
