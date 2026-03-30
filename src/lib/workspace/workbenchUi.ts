/**
 * @file workbenchUi.ts
 * @description 工作台共享 UI 网关，承接外层主链对通用工作台 UI 组件的依赖
 * @module lib/workspace/workbenchUi
 */

export {
  CanvasBreadcrumbHeader,
  type CanvasBreadcrumbHeaderProps,
} from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";

export {
  ImageGallery,
  type ImageGalleryProps,
} from "@/components/content-creator/material/ImageGallery";

export { LayoutTransition } from "@/components/content-creator/core/LayoutTransition/LayoutTransition";

export { StepProgress } from "@/components/content-creator/core/StepGuide/StepProgress";
