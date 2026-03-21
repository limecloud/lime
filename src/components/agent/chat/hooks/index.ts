/**
 * Agent Chat Hook 统一导出
 *
 * 当前默认统一走 Aster 后端
 */

import { useAsterAgentChat } from "./useAsterAgentChat";
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
  disableSessionRestore?: boolean;
}

/**
 * 统一的 Agent Chat Hook
 *
 * 为避免双 Hook 并发导致的副作用，统一直接走 Aster。
 */
export function useAgentChatUnified(options: UseAgentChatUnifiedOptions) {
  return useAsterAgentChat(options);
}

// 旧 useAgentChat 已删除，避免新代码继续沿 compat 路径扩展。
export { useAsterAgentChat } from "./useAsterAgentChat";
export { useRuntimeTeamFormation } from "./useRuntimeTeamFormation";
export { useTeamWorkspaceRuntime } from "./useTeamWorkspaceRuntime";
export { useCompatSubagentRuntime } from "./useCompatSubagentRuntime";
export { useThemeContextWorkspace } from "./useThemeContextWorkspace";
export { useTopicBranchBoard } from "./useTopicBranchBoard";
