/**
 * @file workbenchCanvas.ts
 * @description 工作台画布共享网关，承接外层主链对画布实现的依赖
 * @module lib/workspace/workbenchCanvas
 */

export { CanvasFactory } from "@/components/workspace/canvas/CanvasFactory";

export {
  createInitialCanvasState,
  type CanvasStateUnion,
  type CanvasType,
} from "@/components/workspace/canvas/canvasUtils";

export { createInitialDocumentState } from "@/components/workspace/document/types";

export {
  NotionEditor,
  type NotionEditorHandle,
} from "@/components/workspace/document/editor/NotionEditor";

export { ContentReviewPanel } from "@/components/workspace/document/ContentReviewPanel";

export { DOCUMENT_CANVAS_HOTKEYS } from "@/components/workspace/document/documentCanvasHotkeys";

export { DOCUMENT_EDITOR_HOTKEYS } from "@/components/workspace/document/documentEditorHotkeys";

export {
  COVER_IMAGE_REPLACED_EVENT,
  COVER_IMAGE_WORKBENCH_REQUEST_EVENT,
  type CoverImageReplacedDetail,
  type CoverImageWorkbenchRequestDetail,
} from "@/components/workspace/document/platforms/CoverImagePlaceholder";

export type {
  AutoContinueRunPayload,
  ContentReviewExpert,
  ContentReviewRunPayload,
  CustomContentReviewExpertInput,
  DocumentCanvasState,
  DocumentVersion,
  PlatformType,
  TextStylizeRunPayload,
} from "@/components/workspace/document/types";

export { VideoCanvas } from "@/components/workspace/video/VideoCanvas";

export {
  createInitialVideoState,
  type VideoCanvasState,
} from "@/components/workspace/video/types";
