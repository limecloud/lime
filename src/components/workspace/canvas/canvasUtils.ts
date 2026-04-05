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
 * 当前工作台主题统一收口到 general，并默认使用文档画布
 *
 * 设计原则：
 * - 当前工作台统一使用 document 画布
 * - video 画布只作为独立媒体画布能力保留，不再由旧主题驱动
 */
const THEME_TO_CANVAS_TYPE: Record<ThemeType, CanvasType | null> = {
  general: "document",
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
