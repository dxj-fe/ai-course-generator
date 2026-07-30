/**
 * 兼容的独立能力 API 只从该稳定入口调用 Agent 内部能力。
 * 这些函数没有独立 WorkOrder，不会被注册成 Agent。
 */
export { runHtmlEngineerModelStep } from "@/server/agent/plugins/model-steps/course/html-engineer-model-step";
export { runPageQAModelStep } from "@/server/agent/plugins/model-steps/course/page-qa-model-step";
export { runPageWriterModelStep } from "@/server/agent/plugins/model-steps/course/page-writer-model-step";
export { runImageAssetWorkflow } from "@/server/agent/plugins/tools/course/image-assets";
export { runToolCallDemo } from "@/server/agent/plugins/tools/course/template-demo";
export { loadGeneratedAsset } from "@/server/infra/file/generated-asset";
