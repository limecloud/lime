/**
 * @file 工作流文件映射工具
 * @description 根据主题类型获取文件名到步骤索引的映射
 * @module components/agent/chat/utils/workflowMapping
 */

import type { ThemeType } from "@/lib/workspace/workbenchContract";

/**
 * 根据主题类型获取文件名到步骤索引的映射
 * 不同类型的工作流使用不同的文件名映射
 *
 * 映射关系与 useWorkflow.ts 中的步骤定义保持一致：
 * - social-media: 3-4 步（brief → draft → article → adapted）
 * - video: 3-5 步（brief → outline → storyboard → script → script-final）
 * - document: 3-4 步（brief → outline → draft → article）
 * - general/knowledge/planning: 无工作流
 */
export function getFileToStepMap(theme: ThemeType): Record<string, number> {
  switch (theme) {
    case "social-media":
      return {
        "brief.md": 0, // 明确需求
        "draft.md": 1, // 创作内容
        "article.md": 2, // 润色优化（引导模式）
        "adapted.md": 3, // 平台适配（引导模式）
      };

    case "video":
      return {
        "brief.md": 0, // 明确需求
        "outline.md": 1, // 剧情大纲
        "storyboard.md": 2, // 分镜设计
        "script.md": 3, // 撰写剧本
        "script-final.md": 4, // 润色优化
      };

    case "document":
      return {
        "brief.md": 0, // 明确需求
        "outline.md": 1, // 文档大纲
        "draft.md": 2, // 撰写内容
        "article.md": 3, // 润色优化
      };

    // general, knowledge, planning 不需要映射（无工作流）
    default:
      return {};
  }
}

/**
 * 获取主题支持的所有文件名列表
 */
export function getSupportedFilenames(theme: ThemeType): string[] {
  return Object.keys(getFileToStepMap(theme));
}

/**
 * 检查文件名是否属于指定主题的工作流
 */
export function isWorkflowFile(theme: ThemeType, filename: string): boolean {
  const map = getFileToStepMap(theme);
  return filename in map;
}

/**
 * 获取文件对应的步骤索引，如果不存在返回 undefined
 */
export function getStepIndexForFile(
  theme: ThemeType,
  filename: string,
): number | undefined {
  const map = getFileToStepMap(theme);
  return map[filename];
}
