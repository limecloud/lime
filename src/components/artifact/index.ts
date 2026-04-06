/**
 * @file Artifact 组件模块导出入口
 * @description 仅导出现役 Artifact 预览主链所需的最小公共入口
 * @module components/artifact
 * @requirements 1.1
 */

// ============================================================================
// 核心组件导出
// ============================================================================

/**
 * Artifact 统一渲染入口组件
 * 根据 Artifact 类型分发到对应的渲染器
 */
export { ArtifactRenderer } from "./ArtifactRenderer";

/**
 * Artifact 工具栏组件
 * 提供复制、下载、源码切换等快捷操作
 */
export { ArtifactToolbar } from "./ArtifactToolbar";

/**
 * Artifact 画布过渡遮罩组件
 * 在文件写入开始但首段内容尚未到达前展示稳定反馈
 */
export { ArtifactCanvasOverlay } from "./ArtifactCanvasOverlay";

// ============================================================================
// 渲染器导出
// ============================================================================

/**
 * 轻量渲染器注册入口
 */
export { registerLightweightRenderers } from "./renderers";
