import type { UIMessage } from "ai";

type AiRequestBody = {
  messages?: UIMessage[];
  prompt?: string;
};

export async function readMessages(
  req: Request,
): Promise<UIMessage[] | Response> {
  const body = await req.text();

  if (!body) {
    return Response.json(
      { error: "请求体为空，请通过聊天页面发送消息。" },
      { status: 400 },
    );
  }

  let requestBody: AiRequestBody;

  try {
    requestBody = JSON.parse(body);
  } catch {
    return Response.json({ error: "请求体不是有效的 JSON。" }, { status: 400 });
  }

  if (Array.isArray(requestBody.messages) && requestBody.messages.length > 0) {
    return requestBody.messages;
  }

  const prompt = requestBody.prompt?.trim();

  if (prompt) {
    return [
      {
        id: "user-prompt",
        role: "user",
        parts: [{ type: "text", text: prompt }],
      },
    ] satisfies UIMessage[];
  }

  return Response.json(
    { error: "请求体缺少有效的 prompt 或 messages 数组。" },
    { status: 400 },
  );
}
