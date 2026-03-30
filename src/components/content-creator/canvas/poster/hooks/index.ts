/**
 * @file 海报画布 Hooks 导出
 * @description 导出海报画布相关的自定义 Hooks
 * @module components/content-creator/canvas/poster/hooks
 */

export { useFabricCanvas, zoomUtils } from "./useFabricCanvas";
export type {
  UseFabricCanvasReturn,
  UseFabricCanvasOptions,
} from "./useFabricCanvas";

export {
  useElementOperations,
  transformUtils,
  selectionUtils,
  groupUtils,
} from "./useElementOperations";
export type {
  UseElementOperationsReturn,
  UseElementOperationsOptions,
  ElementTransform,
} from "./useElementOperations";

export { useHistory, historyUtils } from "./useHistory";
export type {
  UseHistoryReturn,
  UseHistoryOptions,
  HistoryState,
} from "./useHistory";

export { usePageOperations, pageUtils } from "./usePageOperations";
export type {
  UsePageOperationsReturn,
  UsePageOperationsOptions,
} from "./usePageOperations";

export { useLayerManager, layerManagerUtils } from "./useLayerManager";
export type {
  UseLayerManagerReturn,
  UseLayerManagerOptions,
} from "./useLayerManager";

export { useAlignment } from "./useAlignment";
export type { UseAlignmentReturn, UseAlignmentOptions } from "./useAlignment";
