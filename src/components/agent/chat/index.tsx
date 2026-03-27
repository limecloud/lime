import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  AgentChatHomeShell,
  type AgentChatWorkspaceBootstrap,
} from "./AgentChatHomeShell";
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
    onNavigate,
    projectId,
    contentId,
    agentEntry = "claw",
    immersiveHome: _immersiveHome = false,
    theme,
    initialCreationMode,
    lockTheme = false,
    fromResources = false,
    initialUserPrompt,
    initialUserImages,
    initialSessionName,
    entryBannerMessage,
    newChatAt,
    autoRunInitialPromptOnMount = false,
    onHasMessagesChange,
    onSessionChange,
    onWorkflowProgressChange,
    openBrowserAssistOnMount = false,
  } = props;

  const shouldRenderHomeShell =
    agentEntry === "new-task" &&
    !contentId &&
    !initialUserPrompt &&
    !(initialUserImages && initialUserImages.length > 0) &&
    !initialSessionName &&
    !entryBannerMessage &&
    !openBrowserAssistOnMount &&
    !fromResources;
  const shouldForceClawWorkspace =
    agentEntry === "new-task" &&
    (Boolean(initialUserPrompt?.trim()) ||
      Boolean(initialUserImages?.length) ||
      Boolean(initialSessionName?.trim()) ||
      Boolean(entryBannerMessage?.trim()) ||
      openBrowserAssistOnMount);

  const [workspaceBootstrap, setWorkspaceBootstrap] =
    useState<AgentChatWorkspaceBootstrap | null>(null);
  const activeBootstrap = shouldRenderHomeShell ? workspaceBootstrap : null;
  const effectiveAgentEntry =
    activeBootstrap || shouldForceClawWorkspace ? "claw" : agentEntry;
  const effectiveShowChatPanel =
    activeBootstrap || shouldForceClawWorkspace ? true : props.showChatPanel;

  const handleEnterWorkspace = useCallback(
    (payload: AgentChatWorkspaceBootstrap) => {
      void loadAgentChatWorkspace();
      setWorkspaceBootstrap(payload);
    },
    [],
  );

  useEffect(() => {
    if (!shouldRenderHomeShell) {
      setWorkspaceBootstrap(null);
      return;
    }

    return scheduleWorkspacePrefetch(() => {
      void loadAgentChatWorkspace();
    });
  }, [shouldRenderHomeShell]);

  useEffect(() => {
    if (!shouldRenderHomeShell || typeof newChatAt !== "number") {
      return;
    }

    setWorkspaceBootstrap(null);
  }, [newChatAt, shouldRenderHomeShell]);

  useEffect(() => {
    if (!shouldRenderHomeShell || activeBootstrap) {
      return;
    }

    onHasMessagesChange?.(false);
    onSessionChange?.(null);
    onWorkflowProgressChange?.(null);
  }, [
    activeBootstrap,
    onHasMessagesChange,
    onSessionChange,
    onWorkflowProgressChange,
    shouldRenderHomeShell,
  ]);

  const homeShellNode = (
    <AgentChatHomeShell
      onNavigate={onNavigate}
      projectId={projectId}
      theme={theme}
      initialCreationMode={initialCreationMode}
      lockTheme={lockTheme}
      onEnterWorkspace={handleEnterWorkspace}
    />
  );

  if (shouldRenderHomeShell && !activeBootstrap) {
    return homeShellNode;
  }

  return (
    <Suspense fallback={shouldRenderHomeShell ? homeShellNode : null}>
      <LazyAgentChatWorkspace
        {...props}
        agentEntry={effectiveAgentEntry}
        showChatPanel={effectiveShowChatPanel}
        projectId={activeBootstrap?.projectId ?? projectId}
        contentId={activeBootstrap?.contentId ?? contentId}
        theme={activeBootstrap?.theme ?? theme}
        initialCreationMode={
          activeBootstrap?.initialCreationMode ?? initialCreationMode
        }
        initialUserPrompt={
          activeBootstrap?.initialUserPrompt ?? initialUserPrompt
        }
        initialUserImages={
          activeBootstrap?.initialUserImages ?? initialUserImages
        }
        initialRequestMetadata={
          activeBootstrap?.initialRequestMetadata ??
          props.initialRequestMetadata
        }
        autoRunInitialPromptOnMount={
          activeBootstrap?.autoRunInitialPromptOnMount ??
          autoRunInitialPromptOnMount
        }
        newChatAt={activeBootstrap?.newChatAt ?? newChatAt}
        openBrowserAssistOnMount={
          activeBootstrap?.openBrowserAssistOnMount ?? openBrowserAssistOnMount
        }
      />
    </Suspense>
  );
}
