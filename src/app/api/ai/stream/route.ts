import { handleStreamTextRequest } from "@/server/infra/ai/handlers";

export const runtime = "nodejs";

export const POST = handleStreamTextRequest;
