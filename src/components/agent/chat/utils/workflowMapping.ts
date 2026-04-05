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
 * 当前工作台主题已统一为 general，不再维护旧主题专属文件映射。
 */
export function getFileToStepMap(theme: ThemeType): Record<string, number> {
  void theme;
  return {};
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
