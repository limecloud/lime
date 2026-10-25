import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("AgentChatWorkspace send surface runtime boundary", () => {
  it("发送、图片工作台桥接和工作区技能触发必须由 send surface runtime 组合", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const commandWiringSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandWiring.ts",
      ),
      "utf8",
    );
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceSendSurfaceRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useAgentChatWorkspaceCommandWiring({");
    expect(workspaceSource).not.toContain("useWorkspaceSendSurfaceRuntime({");
    expect(commandWiringSource).toContain("useWorkspaceSendSurfaceRuntime({");
    expect(ownerSource.split("\n").length).toBeLessThan(130);
    for (const retiredWorkspaceSendGlue of [
      "useWorkspaceImageWorkbenchRuntime(",
      "useWorkspaceSendActions(",
      "bindImageWorkbenchHandleSendRef(",
      "sceneGateResumeHandlerRef.current =",
      "[LocalConversationPage] 执行技能命令:",
    ]) {
      expect(workspaceSource).not.toContain(retiredWorkspaceSendGlue);
      expect(ownerSource).toContain(retiredWorkspaceSendGlue);
    }
  });
});
