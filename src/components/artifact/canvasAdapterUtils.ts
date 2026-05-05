/**
 * @file Canvas 适配器工具函数
 * @description 将 Canvas 类型的 Artifact 适配到现有 Canvas 系统的工具函数
 * @module components/artifact/canvasAdapterUtils
 * @requirements 12.1, 12.2, 12.3, 12.5
 */

import {
  normalizeArtifactType,
  type Artifact,
  type ArtifactType,
} from "@/lib/artifact/types";

// Canvas 系统导入
import type {
  CanvasStateUnion,
  CanvasType,
  DocumentCanvasState,
} from "@/lib/workspace/workbenchCanvas";
import {
  createInitialDocumentState,
  createDesignCanvasStateFromContent,
  createInitialVideoState,
} from "@/lib/workspace/workbenchCanvas";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Canvas 元数据接口
 * 保留 Canvas 特定的元数据
 * @requirements 12.5
 */
export interface CanvasMetadata {
  /** Canvas 平台类型 */
  platform?: string;
  /** Canvas 版本 */
  version?: string;
  /** 其他自定义数据 */
  [key: string]: unknown;
}

// ============================================================================
// 常量定义
// ============================================================================

/**
 * Artifact Canvas 类型到 Canvas 系统类型的映射
 * 旧专用 Canvas 类型不再归一到现役类型，避免继续扩展旧主题面。
 */
export const ARTIFACT_TO_CANVAS_TYPE: Record<
  Extract<ArtifactType, "canvas:document" | "canvas:video" | "canvas:design">,
  CanvasType
> = {
  "canvas:document": "document",
  "canvas:video": "video",
  "canvas:design": "design",
};

/**
 * Canvas 类型显示名称
 */
export const CANVAS_TYPE_LABELS: Record<CanvasType, string> = {
  document: "文档",
  video: "视频",
  design: "图层设计",
};

/**
 * Canvas 类型图标
 */
export const CANVAS_TYPE_ICONS: Record<CanvasType, string> = {
  document: "📄",
  video: "🎞️",
  design: "🧩",
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 Artifact 类型获取 Canvas 类型
 * @param artifactType - Artifact 类型
 * @returns Canvas 类型，如果不是 Canvas 类型则返回 null
 * @requirements 12.1
 */
export function getCanvasTypeFromArtifact(
  artifactType: ArtifactType | string,
): CanvasType | null {
  const normalizedType =
    typeof artifactType === "string"
      ? normalizeArtifactType(artifactType)
      : artifactType;
  if (
    normalizedType !== "canvas:document" &&
    normalizedType !== "canvas:video" &&
    normalizedType !== "canvas:design"
  ) {
    return null;
  }
  return ARTIFACT_TO_CANVAS_TYPE[normalizedType] || null;
}

/**
 * 检测是否为 Canvas 类型的 Artifact
 * @param artifactType - Artifact 类型
 * @returns 是否为 Canvas 类型
 * @requirements 12.1
 */
export function isCanvasArtifact(artifactType: ArtifactType | string): boolean {
  return artifactType.startsWith("canvas:");
}

/**
 * 验证文档平台类型
 */
function isValidDocumentPlatform(
  platform: string,
): platform is "wechat" | "xiaohongshu" | "zhihu" | "markdown" {
  return ["wechat", "xiaohongshu", "zhihu", "markdown"].includes(platform);
}

/**
 * 根据 Artifact 创建初始 Canvas 状态
 * @param artifact - Artifact 对象
 * @returns Canvas 状态，如果类型不支持则返回 null
 * @requirements 12.2
 */
export function createCanvasStateFromArtifact(
  artifact: Artifact,
): CanvasStateUnion | null {
  const canvasType = getCanvasTypeFromArtifact(artifact.type);
  if (!canvasType) return null;

  const content = artifact.content;
  const meta = artifact.meta as CanvasMetadata;

  switch (canvasType) {
    case "document": {
      const state = createInitialDocumentState(content);
      // 应用元数据中的平台设置
      if (meta.platform && isValidDocumentPlatform(meta.platform)) {
        return { ...state, platform: meta.platform } as DocumentCanvasState;
      }
      return state;
    }
    case "video":
      return createInitialVideoState(content);
    case "design":
      return createDesignCanvasStateFromContent(content);
    default:
      return null;
  }
}

/**
 * 从 Canvas 状态提取内容
 * @param state - Canvas 状态
 * @returns 内容字符串
 * @requirements 12.3
 */
export function extractContentFromCanvasState(state: CanvasStateUnion): string {
  switch (state.type) {
    case "document":
      return (state as DocumentCanvasState).content;
    case "video":
      return state.prompt;
    case "design":
      return JSON.stringify(state.document, null, 2);
    default:
      return "";
  }
}

/**
 * 提取 Canvas 元数据
 * @param state - Canvas 状态
 * @returns Canvas 元数据
 * @requirements 12.5
 */
export function extractCanvasMetadata(state: CanvasStateUnion): CanvasMetadata {
  const metadata: CanvasMetadata = {
    version: "1.0",
  };

  switch (state.type) {
    case "document":
      metadata.platform = (state as DocumentCanvasState).platform;
      break;
    case "design":
      metadata.platform = "layered-design";
      metadata.schemaVersion = state.document.schemaVersion;
      metadata.designId = state.document.id;
      break;
  }

  return metadata;
}
