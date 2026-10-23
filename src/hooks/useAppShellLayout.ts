import type { AgentPageParams, Page, PageParams } from "@/types/page";

interface AppShellLayoutState {
  shouldHideSidebarForAgent: boolean;
  shouldShowAppSidebar: boolean;
}

export function getAppShellLayoutState(params: {
  currentPage: Page;
  pageParams: PageParams;
  agentHasMessages: boolean;
}): AppShellLayoutState {
  const currentAgentParams = params.pageParams as AgentPageParams;
  const shouldHideSidebarForAgent =
    params.currentPage === "agent" &&
    (Boolean(currentAgentParams.fromResources) ||
      Boolean(currentAgentParams.immersiveHome) ||
      (params.agentHasMessages && Boolean(currentAgentParams.lockTheme)));

  const shouldShowAppSidebar =
    params.currentPage !== "resources" && !shouldHideSidebarForAgent;

  return {
    shouldHideSidebarForAgent,
    shouldShowAppSidebar,
  };
}

export function useAppShellLayout(params: {
  currentPage: Page;
  pageParams: PageParams;
  agentHasMessages: boolean;
}): AppShellLayoutState {
  return getAppShellLayoutState(params);
}
