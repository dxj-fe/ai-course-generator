export {
  FunctionalTemplateSchema,
  FunctionalTemplateSlotNameSchema,
  FunctionalTemplateSlotSchema,
  type FunctionalTemplate,
  type FunctionalTemplateSlot,
  type FunctionalTemplateSlotName,
} from "./schema";
export { functionalTemplates } from "./templates";
export {
  getFunctionalTemplate,
  listFunctionalTemplates,
  searchFunctionalTemplates,
  type FunctionalTemplateMatch,
  type FunctionalTemplateSearchInput,
} from "./registry";
export {
  functionalTemplateExamples,
  getFunctionalTemplateExample,
} from "./examples";
export {
  functionalTemplateDslExamples,
  getFunctionalTemplateDslExample,
} from "./dsl-examples";
