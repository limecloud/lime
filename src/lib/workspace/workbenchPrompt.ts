/**
 * @file workbenchPrompt.ts
 * @description 工作台提示词共享网关，避免外层主链直连 content-creator prompt 模块
 * @module lib/workspace/workbenchPrompt
 */

export {
  generateContentCreationPrompt,
  needsFullWorkflow,
} from "@/components/content-creator/utils/systemPrompt";

export { generateProjectMemoryPrompt } from "@/components/content-creator/utils/projectPrompt";
