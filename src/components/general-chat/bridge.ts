/**
 * @file bridge.ts
 * @description general-chat 对外桥接层
 * @module components/general-chat/bridge
 *
 * 仅用于其他模块在治理过渡期按需复用少量稳定能力，
 * 避免继续直接深挖 `general-chat` 内部实现目录。
 */

export { CanvasPanel } from "./canvas";
export { DEFAULT_CANVAS_STATE } from "./types";
export type { CanvasState, Message } from "./types";
