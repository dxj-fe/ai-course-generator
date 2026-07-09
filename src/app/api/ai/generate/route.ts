import { handleGenerateTextRequest } from "@/server/ai/handlers";

export const runtime = "nodejs";

export const POST = handleGenerateTextRequest;
