import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";

type AgentEntry = NonNullable<AgentChatWorkspaceProps["agentEntry"]>;

type AgentChatPageShellInput = Pick<
  AgentChatWorkspaceProps,
  | "agentEntry"
  | "initialInputCapability"
  | "initialPendingServiceSkillLaunch"
  | "initialProjectFileOpenTarget"
  | "initialSessionId"
  | "initialSiteSkillLaunch"
  | "initialUserImages"
  | "initialUserPrompt"
  | "openBrowserAssistOnMount"
  | "preferHomeForInitialInputCapability"
  | "showChatPanel"
>;

export interface AgentChatPageShellViewModel {
  hasDirectWorkspaceIntent: boolean;
  shouldForceClawWorkspace: boolean;
  effectiveAgentEntry: AgentEntry;
  effectiveShowChatPanel: AgentChatWorkspaceProps["showChatPanel"];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function resolveAgentChatPageShellViewModel(
  props: AgentChatPageShellInput,
): AgentChatPageShellViewModel {
  const agentEntry = props.agentEntry ?? "claw";
  const preferHomeForInitialInputCapability =
    props.preferHomeForInitialInputCapability ?? false;

  const hasDirectWorkspaceIntent =
    hasText(props.initialUserPrompt) ||
    hasText(props.initialSessionId) ||
    Boolean(props.initialUserImages?.length) ||
    hasText(props.initialSiteSkillLaunch?.adapterName) ||
    hasText(props.initialPendingServiceSkillLaunch?.skillId) ||
    (preferHomeForInitialInputCapability
      ? false
      : Boolean(props.initialInputCapability)) ||
    hasText(props.initialProjectFileOpenTarget?.relativePath) ||
    Boolean(props.openBrowserAssistOnMount);

  const shouldForceClawWorkspace =
    agentEntry === "new-task" && hasDirectWorkspaceIntent;

  return {
    hasDirectWorkspaceIntent,
    shouldForceClawWorkspace,
    effectiveAgentEntry: shouldForceClawWorkspace ? "claw" : agentEntry,
    effectiveShowChatPanel: shouldForceClawWorkspace
      ? true
      : props.showChatPanel,
  };
}
