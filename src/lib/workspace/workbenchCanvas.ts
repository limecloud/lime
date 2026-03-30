/**
 * @file workbenchCanvas.ts
 * @description 工作台画布共享网关，避免外层主链直接依赖 content-creator canvas 目录
 * @module lib/workspace/workbenchCanvas
 */

export { CanvasFactory } from "@/components/content-creator/canvas/CanvasFactory";

export {
  createInitialCanvasState,
  type CanvasStateUnion,
  type CanvasType,
} from "@/components/content-creator/canvas/canvasUtils";

export { createInitialDocumentState } from "@/components/content-creator/canvas/document";

export {
  NotionEditor,
  type NotionEditorHandle,
} from "@/components/content-creator/canvas/document/editor";

export { ContentReviewPanel } from "@/components/content-creator/canvas/document/ContentReviewPanel";

export {
  DOCUMENT_CANVAS_HOTKEYS,
} from "@/components/content-creator/canvas/document/documentCanvasHotkeys";

export {
  DOCUMENT_EDITOR_HOTKEYS,
} from "@/components/content-creator/canvas/document/documentEditorHotkeys";

export {
  COVER_IMAGE_REPLACED_EVENT,
  COVER_IMAGE_WORKBENCH_REQUEST_EVENT,
  type CoverImageReplacedDetail,
  type CoverImageWorkbenchRequestDetail,
} from "@/components/content-creator/canvas/document/platforms/CoverImagePlaceholder";

export type {
  AutoContinueRunPayload,
  ContentReviewExpert,
  ContentReviewRunPayload,
  CustomContentReviewExpertInput,
  DocumentCanvasState,
  DocumentVersion,
  PlatformType,
  TextStylizeRunPayload,
} from "@/components/content-creator/canvas/document/types";

export {
  createInitialMusicState,
  type MusicCanvasState,
} from "@/components/content-creator/canvas/music/types";

export { parseLyrics } from "@/components/content-creator/canvas/music/utils/lyricsParser";

export {
  countWords,
  createInitialNovelState,
} from "@/components/content-creator/canvas/novel";

export type { NovelCanvasState } from "@/components/content-creator/canvas/novel/types";

export {
  createInitialPosterState,
  type PosterCanvasState,
} from "@/components/content-creator/canvas/poster";

export {
  POSTER_CANVAS_HOTKEYS,
} from "@/components/content-creator/canvas/poster/hooks/posterCanvasHotkeys";

export {
  createInitialScriptState,
  scriptStateToText,
  type ScriptCanvasState,
} from "@/components/content-creator/canvas/script";

export {
  VideoCanvas,
  createInitialVideoState,
  type VideoCanvasState,
} from "@/components/content-creator/canvas/video";
