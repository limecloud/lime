/**
 * @file 画布工具函数
 * @description 画布相关的工具函数和类型定义
 * @module components/workspace/canvas/canvasUtils
 */

import type { ThemeType } from "@/lib/workspace/workflowTypes";
import {
  createInitialDocumentState,
  type DocumentCanvasState,
} from "@/components/workspace/document/types";
import { createInitialVideoState } from "@/components/workspace/video/types";
import type { VideoCanvasState } from "@/components/workspace/video/types";

/**
 * 画布状态联合类型
 */
export type CanvasStateUnion = DocumentCanvasState | VideoCanvasState;

/**
 * 画布类型
 */
export type CanvasType = "document" | "video";

/**
 * 主题到画布类型的映射
 * 所有当前主题都支持画布，只有视频使用专用画布
 *
 * 设计原则：
 * - 所有主题都可以触发画布（当检测到 <write_file> 标签时）
 * - 文字类主题统一使用 document 画布
 * - 视频主题使用专用 video 画布
 */
const THEME_TO_CANVAS_TYPE: Record<ThemeType, CanvasType | null> = {
  general: "document", // 通用对话也支持文档画布
  "social-media": "document",
  knowledge: "document", // 知识探索支持文档画布
  planning: "document", // 计划规划支持文档画布
  document: "document",
  video: "video",
};

/**
 * 获取主题对应的画布类型
 */
export function getCanvasTypeForTheme(theme: ThemeType): CanvasType | null {
  return THEME_TO_CANVAS_TYPE[theme];
}

/**
 * 判断主题是否支持画布
 */
export function isCanvasSupported(theme: ThemeType): boolean {
  return THEME_TO_CANVAS_TYPE[theme] !== null;
}

/**
 * 根据主题创建初始画布状态
 */
export function createInitialCanvasState(
  theme: ThemeType,
  content?: string,
): CanvasStateUnion | null {
  const canvasType = THEME_TO_CANVAS_TYPE[theme];

  switch (canvasType) {
    case "document":
      return createInitialDocumentState(content || "");
    case "video":
      return createInitialVideoState(content);
    default:
      return null;
  }
}
