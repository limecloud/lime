/**
 * @file Canvas 适配器工具函数
 * @description 将 Canvas 类型的 Artifact 适配到现有 Canvas 系统的工具函数
 * @module components/artifact/canvasAdapterUtils
 * @requirements 12.1, 12.2, 12.3, 12.5
 */

import type { Artifact, ArtifactType } from "@/lib/artifact/types";

// Canvas 系统导入
import type {
  CanvasStateUnion,
  CanvasType,
  DocumentCanvasState,
  MusicCanvasState,
  NovelCanvasState,
  PosterCanvasState,
  ScriptCanvasState,
} from "@/lib/workspace/workbenchCanvas";
import {
  createInitialDocumentState,
  createInitialMusicState,
  createInitialNovelState,
  createInitialPosterState,
  createInitialScriptState,
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
 */
export const ARTIFACT_TO_CANVAS_TYPE: Record<string, CanvasType> = {
  "canvas:document": "document",
  "canvas:poster": "poster",
  "canvas:music": "music",
  "canvas:script": "script",
  "canvas:novel": "novel",
  "canvas:video": "video",
};

/**
 * Canvas 类型显示名称
 */
export const CANVAS_TYPE_LABELS: Record<CanvasType, string> = {
  document: "文档",
  poster: "海报",
  music: "音乐",
  script: "剧本",
  novel: "小说",
  video: "视频",
};

/**
 * Canvas 类型图标
 */
export const CANVAS_TYPE_ICONS: Record<CanvasType, string> = {
  document: "📄",
  poster: "🎨",
  music: "🎵",
  script: "🎬",
  novel: "📚",
  video: "🎞️",
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
  artifactType: ArtifactType,
): CanvasType | null {
  return ARTIFACT_TO_CANVAS_TYPE[artifactType] || null;
}

/**
 * 检测是否为 Canvas 类型的 Artifact
 * @param artifactType - Artifact 类型
 * @returns 是否为 Canvas 类型
 * @requirements 12.1
 */
export function isCanvasArtifact(artifactType: ArtifactType): boolean {
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
    case "poster":
      return createInitialPosterState();
    case "music":
      return createInitialMusicState();
    case "script":
      return createInitialScriptState(content);
    case "novel":
      return createInitialNovelState(content);
    case "video":
      return createInitialVideoState(content);
    default:
      return null;
  }
}

/**
 * 剧本状态转文本（简化版）
 */
function scriptStateToText(state: ScriptCanvasState): string {
  let text = "";
  if (state.title) text += `# ${state.title}\n\n`;
  if (state.synopsis) text += `${state.synopsis}\n\n`;
  for (const scene of state.scenes) {
    text += `## 第${scene.number}场：${scene.location}（${scene.time}）\n\n`;
    if (scene.description) text += `*${scene.description}*\n\n`;
    for (const dialogue of scene.dialogues) {
      if (dialogue.direction) text += `（${dialogue.direction}）\n`;
      text += `${dialogue.characterName}：${dialogue.content}\n`;
    }
    text += "\n";
  }
  return text;
}

/**
 * 小说状态转文本（简化版）
 */
function novelStateToText(state: NovelCanvasState): string {
  let text = "";
  if (state.title) text += `# ${state.title}\n\n`;
  if (state.synopsis) text += `> ${state.synopsis}\n\n`;
  for (const chapter of state.chapters) {
    text += `## ${chapter.title}\n\n${chapter.content}\n\n`;
  }
  return text;
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
    case "poster":
      // 海报状态序列化为 JSON
      return JSON.stringify(state, null, 2);
    case "music":
      // 音乐状态序列化为 JSON
      return JSON.stringify(state, null, 2);
    case "script": {
      // 剧本状态转换为文本
      const scriptState = state as ScriptCanvasState;
      return scriptStateToText(scriptState);
    }
    case "novel": {
      // 小说状态转换为文本
      const novelState = state as NovelCanvasState;
      return novelStateToText(novelState);
    }
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
    case "poster":
      metadata.pageCount = (state as PosterCanvasState).pages.length;
      break;
    case "music":
      metadata.songType = (state as MusicCanvasState).spec.songType;
      metadata.viewMode = (state as MusicCanvasState).viewMode;
      break;
    case "script":
      metadata.sceneCount = (state as ScriptCanvasState).scenes.length;
      break;
    case "novel":
      metadata.chapterCount = (state as NovelCanvasState).chapters.length;
      break;
  }

  return metadata;
}
