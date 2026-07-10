import {
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";

import { generateTextSafe, streamTextSafe } from "./client";
import { createAiErrorResponse, toAiErrorPayload } from "./error";
import { readAiRequest } from "./request";

export async function handleGenerateTextRequest(req: Request) {
  const aiRequest = await readAiRequest(req);

  if (aiRequest instanceof Response) {
    return aiRequest;
  }

  try {
    const { text } = await generateTextSafe(aiRequest);

    return new Response(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return createAiErrorResponse(error, aiRequest.traceId);
  }
}

export async function handleStreamTextRequest(req: Request) {
  const aiRequest = await readAiRequest(req);

  if (aiRequest instanceof Response) {
    return aiRequest;
  }

  try {
    const result = await streamTextSafe(aiRequest);

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        onError: (error) =>
          JSON.stringify(toAiErrorPayload(error, aiRequest.traceId)),
      }),
    });
  } catch (error) {
    return createAiErrorResponse(error, aiRequest.traceId);
  }
}
