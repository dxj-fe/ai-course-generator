import type { UIMessage } from "ai";

export function createUserMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

export function getMessageText(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function getErrorText(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    const code =
      "code" in payload && typeof payload.code === "string"
        ? `[${payload.code}] `
        : "";
    const traceId =
      "traceId" in payload && typeof payload.traceId === "string"
        ? ` traceId: ${payload.traceId}`
        : "";

    return `${code}${payload.message}${traceId}`;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return "请求失败，请检查模型配置或服务端日志。";
}
