/**
 * Agent Chat Hook 统一导出
 *
 * 当前默认统一走 Agent 后端
 */

import { useAgentChat } from "./useAgentChat";

import type { InterruptedInputRestoreRequest } from "./agentStreamInputRestoreTypes";
export { useArtifactAutoPreviewSync } from "./useArtifactAutoPreviewSync";

export type { Topic } from "./agentChatShared";

/** Hook 配置选项 */
interface UseAgentChatUnifiedOptions {
  systemPrompt?: string;

  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  workspaceId: string;
  workingDir?: string | null;
  disableSessionRestore?: boolean;
  sessionRestorePresentation?: "foreground" | "background";
  initialTopicsLoadMode?: "immediate" | "deferred";
  initialTopicsDeferredDelayMs?: number;
  initialRuntimeWarmupLoadMode?: "immediate" | "deferred";
  initialRuntimeWarmupDeferredDelayMs?: number;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => import("../utils/chatToolPreferences").ChatToolPreferences | null;
  onOpenSubagents?: () => void;
  onRestoreInterruptedInput?: (request: InterruptedInputRestoreRequest) => void;

}

/**
 * 统一的 Agent Chat Hook
 *
 * 为避免双 Hook 并发导致的副作用，统一直接走 Agent。
 */
export function useAgentChatUnified(options: UseAgentChatUnifiedOptions) {
  return useAgentChat(options);
}

// 旧 useAgentChat 已删除，避免新代码继续沿 compat 路径扩展。
export { useAgentChat } from "./useAgentChat";
export { useTopicBranchBoard } from "./useTopicBranchBoard";
