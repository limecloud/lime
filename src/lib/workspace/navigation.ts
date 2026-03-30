import type { AgentPageParams, WorkspaceViewMode } from "@/types/page";

export function buildHomeAgentParams(
  overrides: Partial<AgentPageParams> = {},
): AgentPageParams {
  return {
    ...overrides,
    agentEntry: "new-task",
    immersiveHome: overrides.immersiveHome ?? false,
    theme: "general",
    lockTheme: false,
    newChatAt: Date.now(),
  };
}

export function buildClawAgentParams(
  overrides: Partial<AgentPageParams> = {},
): AgentPageParams {
  return {
    ...overrides,
    agentEntry: "claw",
    immersiveHome: overrides.immersiveHome ?? false,
    theme: overrides.theme ?? "general",
    lockTheme: overrides.lockTheme ?? false,
  };
}

export function buildWorkspaceResetParams(
  overrides: Partial<AgentPageParams> = {},
  workspaceViewMode: WorkspaceViewMode = "project-management",
): AgentPageParams {
  return {
    ...overrides,
    workspaceViewMode,
    workspaceResetAt: Date.now(),
  };
}
