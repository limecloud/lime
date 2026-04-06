/**
 * @file Artifact Hooks 导出入口
 * @description 统一导出 Artifact 相关的 React Hooks
 * @module lib/artifact/hooks
 * @requirements 9.4, 11.2
 */

// 现役公共入口仅保留通用防抖 Hook。
// @requirements 11.2
export { useDebouncedValue, useDebouncedCallback } from "./useDebouncedValue";
