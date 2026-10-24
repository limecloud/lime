import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const CONSUMER_PATHS = [
  "src/components/agent/chat/components/generalWorkbenchTaskRailContextViewModel.ts",
  "src/components/agent/chat/components/harnessStatusPanelViewModel.ts",
  "src/components/agent/chat/components/MessageList.types.ts",
  "src/components/agent/chat/components/useMessageListTimelineState.ts",
  "src/components/agent/chat/components/Inputbar/inputbarSendPayload.ts",
  "src/components/agent/chat/hooks/agentChatHistoryArtifacts.ts",
  "src/components/agent/chat/hooks/agentChatHistoryHydrate.ts",
  "src/components/agent/chat/hooks/agentChatHistoryNormalize.ts",
  "src/components/agent/chat/hooks/agentChatHistoryReadModel.ts",
  "src/components/agent/chat/hooks/agentChatHistoryThreadItems.ts",
  "src/components/agent/chat/hooks/agentChatHistoryTimelineBasics.ts",
  "src/components/agent/chat/hooks/agentChatHistoryTimelineMerge.ts",
  "src/components/agent/chat/hooks/agentChatHistoryTypes.ts",
  "src/components/agent/chat/hooks/agentChatHistoryUsage.ts",
  "src/components/agent/chat/hooks/agentSessionTimelineMergePolicy.ts",
  "src/components/agent/chat/hooks/agentSilentTurnRecovery.ts",
  "src/components/agent/chat/hooks/sessionHistoryMergeController.ts",
  "src/components/agent/chat/utils/sessionExecutionRuntime.ts",
  "src/components/agent/chat/workspace/imageCommandIntent.ts",
  "src/components/agent/chat/workspace/imageWorkbenchTaskActions.ts",
  "src/components/agent/chat/workspace/useWorkspaceCanvasWorkflowActions.ts",
  "src/components/agent/chat/workspace/workspaceConversationSessionViewModel.ts",
  "src/components/agent/chat/workspace/workspaceConversationWorkbenchViewModel.ts",
  "src/components/agent/chat/hooks/agentSessionRefresh.ts",
  "src/components/agent/chat/hooks/agentStreamRequestStartController.ts",
  "src/components/agent/chat/hooks/agentStreamSend.ts",
  "src/components/agent/chat/utils/agentTaskRuntime.ts",
  "src/components/agent/chat/utils/inputbarRuntimeStatusLine.ts",
  "src/components/agent/chat/hooks/agentSessionTopicViewModel.ts",
  "src/components/agent/chat/workspace/useWorkspaceArticleEditorRightSurfaceRuntime.ts",
  "src/components/agent/chat/workspace/useSessionRuntimeProjectionDeferral.ts",
  "src/components/agent/chat/workspace/workspaceConversationCodingViews.tsx",
  "src/components/agent/chat/hooks/agentChatShared.ts",
  "src/components/agent/chat/hooks/streamResumeTarget.ts",
  "src/components/agent/chat/hooks/useCommandResume.ts",
  "src/components/agent/chat/hooks/turnEventBindingTypes.ts",
  "src/components/agent/chat/hooks/useAgentStream.ts",
];

describe("session types current owner boundary", () => {
  it("declared consumers 只从 sessionTypes 读取 session DTO", () => {
    for (const relativePath of CONSUMER_PATHS) {
      const source = readFileSync(join(cwd(), relativePath), "utf8");

      expect(source, relativePath).toContain(
        'from "@/lib/api/agentRuntime/sessionTypes"',
      );
      expect(source, relativePath).not.toContain('"@/lib/api/agentRuntime"');
    }
  });

  it("turn binding 从独立类型 owner 读取选项，不恢复重复 DTO 或聚合入口", () => {
    const source = readFileSync(
      join(
        cwd(),
        "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts",
      ),
      "utf8",
    );

    expect(source).toContain('from "./turnEventBindingTypes"');
    expect(source).not.toContain('"@/lib/api/agentRuntime"');
    expect(source).not.toMatch(
      /(?:interface|type)\s+RegisterAgentStreamTurnEventBindingOptions\b/,
    );
  });
});
