import type { ToolCallEvent } from "./executable-tool";

export function logToolCallEvent(event: ToolCallEvent) {
  console.info("[tool]", event);
}
