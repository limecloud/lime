/**
 * @file workbenchPrompt.ts
 * @description 工作台提示词共享网关，承接外层主链对工作台提示词能力的依赖
 * @module lib/workspace/workbenchPrompt
 */

export {
  generateThemeWorkbenchPrompt,
  needsFullWorkflow,
} from "@/lib/workspace/systemPrompt";

export { generateProjectMemoryPrompt } from "@/lib/workspace/projectPrompt";
