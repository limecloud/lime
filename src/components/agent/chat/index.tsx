import { Suspense, lazy, useEffect } from "react";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";

const WORKSPACE_PREFETCH_IDLE_TIMEOUT_MS = 1_500;
const WORKSPACE_PREFETCH_FALLBACK_DELAY_MS = 180;

const loadAgentChatWorkspace = () => import("./AgentChatWorkspace");

const LazyAgentChatWorkspace = lazy(async () => {
  const module = await loadAgentChatWorkspace();
  return { default: module.AgentChatWorkspace };
});

function scheduleWorkspacePrefetch(task: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: WORKSPACE_PREFETCH_IDLE_TIMEOUT_MS,
    });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(
    task,
    WORKSPACE_PREFETCH_FALLBACK_DELAY_MS,
  );
  return () => {
    window.clearTimeout(timeoutId);
  };
}

export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatPage(props: AgentChatWorkspaceProps) {
  const {
    agentEntry = "claw",
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
    Boolean(initialProjectFileOpenTarget?.relativePath?.trim()) ||
    openBrowserAssistOnMount;
  const shouldForceClawWorkspace =
    agentEntry === "new-task" && hasDirectWorkspaceIntent;
  const effectiveAgentEntry = shouldForceClawWorkspace ? "claw" : agentEntry;
  const effectiveShowChatPanel = shouldForceClawWorkspace
    ? true
    : props.showChatPanel;

  useEffect(() => {
    return scheduleWorkspacePrefetch(() => {
      void loadAgentChatWorkspace();
    });
  }, []);

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
    <Suspense fallback={null}>
      <LazyAgentChatWorkspace
        {...props}
        agentEntry={effectiveAgentEntry}
        showChatPanel={effectiveShowChatPanel}
      />
    </Suspense>
  );
}
