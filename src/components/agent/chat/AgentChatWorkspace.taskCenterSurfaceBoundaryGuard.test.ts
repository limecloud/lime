import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("AgentChatWorkspace Task Center surface runtime boundary", () => {
  it("草稿 surface 和 pending preview 由 surface runtime 提供，会话导航不回流", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceTaskCenterSurfaceRuntime.ts",
      ),
      "utf8",
    );
    const shellInteractionOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceShellInteractionRuntime.ts",
      ),
      "utf8",
    );
    const draftSendRuntimeSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useTaskCenterDraftSendRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain(
      "useAgentChatWorkspaceShellInteractionRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "useWorkspaceTaskCenterSurfaceRuntime({",
    );
    expect(shellInteractionOwnerSource).toContain(
      "useWorkspaceTaskCenterSurfaceRuntime({",
    );
    expect(ownerSource.split("\n").length).toBeLessThan(120);
    for (const retiredWorkspaceTaskCenterSurfaceGlue of [
      "resolveTaskCenterDraftSurfaceState(",
      "useTaskCenterHomePendingPreviewRuntime(",
      "buildInitialDispatchPreviewMessages(",
    ]) {
      expect(workspaceSource).not.toContain(
        retiredWorkspaceTaskCenterSurfaceGlue,
      );
      expect(shellInteractionOwnerSource).not.toContain(
        retiredWorkspaceTaskCenterSurfaceGlue,
      );
      expect(ownerSource).toContain(retiredWorkspaceTaskCenterSurfaceGlue);
    }
    for (const source of [
      workspaceSource,
      shellInteractionOwnerSource,
      ownerSource,
    ]) {
      expect(source).not.toContain("buildConversationParams({");
    }

    expect(
      existsSync(
        join(
          process.cwd(),
          "src/components/agent/chat/workspace/homeHotpathPendingShell.ts",
        ),
      ),
    ).toBe(false);
    expect(draftSendRuntimeSource).not.toContain("homeHotpathPendingShell");
    expect(draftSendRuntimeSource).not.toContain(
      "homeInput.pendingShellApplied",
    );
  });
});
