import { handleStreamTextRequest } from "@/server/ai/handlers";

export const runtime = "nodejs";

export const POST = handleStreamTextRequest;
