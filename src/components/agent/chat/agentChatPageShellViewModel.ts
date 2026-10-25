import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";

type AgentEntry = NonNullable<AgentChatWorkspaceProps["agentEntry"]>;

type LocalConversationPageShellInput = Pick<
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

export interface LocalConversationPageShellViewModel {
  hasDirectWorkspaceIntent: boolean;
  shouldOpenConversation: boolean;
  effectiveAgentEntry: AgentEntry;
  effectiveShowChatPanel: AgentChatWorkspaceProps["showChatPanel"];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function resolveLocalConversationPageShellViewModel(
  props: LocalConversationPageShellInput,
): LocalConversationPageShellViewModel {
  const agentEntry = props.agentEntry ?? "conversation";
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

  const shouldOpenConversation =
    agentEntry === "new-task" && hasDirectWorkspaceIntent;

  return {
    hasDirectWorkspaceIntent,
    shouldOpenConversation,
    effectiveAgentEntry: shouldOpenConversation ? "conversation" : agentEntry,
    effectiveShowChatPanel: shouldOpenConversation
      ? true
      : props.showChatPanel,
  };
}
