/**
 * Agent API 兼容门面
 *
 * 新代码请优先直接使用：
 * - `agentRuntime.ts`：现役运行时 API
 * - `agentStream.ts`：流式事件与 UI 类型
 * - `agentCompat.ts`：历史兼容入口
 */

export * from "./agentRuntime";
export * from "./agentStream";
export * from "./agentCompat";
