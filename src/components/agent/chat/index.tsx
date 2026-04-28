import { Suspense, lazy, useEffect } from "react";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";
import { loadAgentChatWorkspaceModule } from "./agentChatWorkspaceLoader";

const WORKSPACE_LOADING_FALLBACK = (
  <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
    正在准备生成工作区...
  </div>
);

const LazyAgentChatWorkspace = lazy(async () => {
  const module = await loadAgentChatWorkspaceModule();
  return { default: module.AgentChatWorkspace };
});

export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatPage(props: AgentChatWorkspaceProps) {
  const {
    agentEntry = "claw",
    initialInputCapability,
    initialPendingServiceSkillLaunch,
    initialProjectFileOpenTarget,
    initialSiteSkillLaunch,
    initialUserImages,
    initialUserPrompt,
    openBrowserAssistOnMount = false,
    onHasMessagesChange,
    onSessionChange,
    onWorkflowProgressChange,
  } = props;

  const hasDirectWorkspaceIntent =
    Boolean(initialUserPrompt?.trim()) ||
    Boolean(initialUserImages?.length) ||
    Boolean(initialSiteSkillLaunch) ||
    Boolean(initialPendingServiceSkillLaunch?.skillId?.trim()) ||
    Boolean(initialInputCapability?.capabilityRoute) ||
    Boolean(initialProjectFileOpenTarget?.relativePath?.trim()) ||
    openBrowserAssistOnMount;
  const shouldForceClawWorkspace =
    agentEntry === "new-task" && hasDirectWorkspaceIntent;
  const effectiveAgentEntry = shouldForceClawWorkspace ? "claw" : agentEntry;
  const effectiveShowChatPanel = shouldForceClawWorkspace
    ? true
    : props.showChatPanel;

  useEffect(() => {
    if (!shouldForceClawWorkspace) {
      return;
    }

    onHasMessagesChange?.(false);
    onSessionChange?.(null);
    onWorkflowProgressChange?.(null);
  }, [
    onHasMessagesChange,
    onSessionChange,
    onWorkflowProgressChange,
    shouldForceClawWorkspace,
  ]);

  return (
    <Suspense fallback={WORKSPACE_LOADING_FALLBACK}>
      <LazyAgentChatWorkspace
        {...props}
        agentEntry={effectiveAgentEntry}
        showChatPanel={effectiveShowChatPanel}
      />
    </Suspense>
  );
}
