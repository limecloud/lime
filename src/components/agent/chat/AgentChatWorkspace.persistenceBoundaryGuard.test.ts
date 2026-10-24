import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("AgentChatWorkspace persistence runtime boundary", () => {
  it("session files 和 document sync 胶水由 persistence runtime 提供，不再同步资源副本", () => {
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
        "src/components/agent/chat/workspace/useWorkspacePersistenceRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useAgentChatWorkspaceCommandWiring({");
    expect(workspaceSource).not.toContain("useWorkspacePersistenceRuntime({");
    expect(commandWiringSource).toContain("useWorkspacePersistenceRuntime({");
    expect(ownerSource.split("\n").length).toBeLessThan(140);
    expect(ownerSource).not.toContain("syncGeneralArtifactToResource");
    expect(ownerSource).not.toContain("useWorkspaceGeneralResourceSync");
    for (const retiredWorkspacePersistenceGlue of [
      "useSessionFiles(",
      "shouldAutoInitWorkspaceSessionFiles(",
      "useWorkspaceCanvasContentSyncRuntime(",
      "useWorkspaceDocumentVersionStatusSyncRuntime(",
    ]) {
      expect(workspaceSource).not.toContain(retiredWorkspacePersistenceGlue);
      expect(ownerSource).toContain(retiredWorkspacePersistenceGlue);
    }
  });
});
