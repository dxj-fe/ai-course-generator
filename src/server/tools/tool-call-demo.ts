import {
  selectPageTemplate,
  type SelectPageTemplateInput,
} from "./template-selector";

export type RunToolCallDemoInput = SelectPageTemplateInput;

export async function runToolCallDemo({
  abortSignal,
  pagePurpose,
  traceId,
}: RunToolCallDemoInput) {
  return selectPageTemplate({
    abortSignal,
    pagePurpose,
    traceId,
  });
}
