import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("AgentChatWorkspace system prompt boundary", () => {
  it("普通聊天不得从前端注入默认角色、创作模式或结构化创作记忆", () => {
    const workspaceSource = [
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");

    expect(workspaceSource).toContain("useAgentChatUnified({");
    for (const retiredPromptGlue of [
      "useWorkspaceSystemPromptRuntime",
      "buildGeneralAgentSystemPrompt",
      "generateGeneralWorkbenchPrompt",
      "generateProjectMemoryPrompt",
      "systemPrompt,",
    ]) {
      expect(workspaceSource).not.toContain(retiredPromptGlue);
    }
  });
});
