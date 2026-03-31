/**
 * @file workbenchUi.ts
 * @description 工作台共享 UI 网关，承接外层主链对通用工作台 UI 组件的依赖
 * @module lib/workspace/workbenchUi
 */

export {
  CanvasBreadcrumbHeader,
  type CanvasBreadcrumbHeaderProps,
} from "@/components/workspace/canvas/shared/CanvasBreadcrumbHeader";

export {
  ImageGallery,
  type ImageGalleryProps,
} from "@/components/workspace/media/ImageGallery";

export { LayoutTransition } from "@/components/workspace/layout/LayoutTransition";

export { StepProgress } from "@/components/workspace/layout/StepProgress";
