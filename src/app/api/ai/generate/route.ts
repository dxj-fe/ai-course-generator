import { handleGenerateTextRequest } from "@/server/infra/ai/handlers";

export const runtime = "nodejs";

export const POST = handleGenerateTextRequest;
