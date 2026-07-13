import type { ToolCallEvent } from "./types";

export function logToolCallEvent(event: ToolCallEvent) {
  console.info("[tool]", event);
}
