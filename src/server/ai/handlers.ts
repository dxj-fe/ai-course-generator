import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  toUIMessageStream,
} from "ai";

import { getErrorMessage } from "@/shared/errors/get-error-message";

import { getLanguageModel } from "./model-provider";
import { readMessages } from "./request";

export async function handleGenerateTextRequest(req: Request) {
  const messages = await readMessages(req);

  if (messages instanceof Response) {
    return messages;
  }

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      messages: await convertToModelMessages(messages),
    });

    return new Response(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function handleStreamTextRequest(req: Request) {
  const messages = await readMessages(req);

  if (messages instanceof Response) {
    return messages;
  }

  try {
    const result = streamText({
      model: getLanguageModel(),
      messages: await convertToModelMessages(messages),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        onError: getErrorMessage,
      }),
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
