import { useEffect, useRef } from "react";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";
import { AgentChatWorkspace } from "./AgentChatWorkspace";
import { resolveLocalConversationPageShellViewModel } from "./agentChatPageShellViewModel";

export type {
  AgentBackgroundSessionRuntimeSnapshot,
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function LocalConversationPage(props: AgentChatWorkspaceProps) {
  const {
    onHasMessagesChange,
    onAgentStreamingChange,
    onWorkflowProgressChange,
  } = props;

  // 性能埋点：记录路由进入时间
  const mountT0 = useRef<number>(performance.now());
  useEffect(() => {
    console.info(
      `[PERF] LocalConversationPage mounted: ${(performance.now() - mountT0.current).toFixed(0)}ms`,
    );
  }, []);

  const {
    effectiveAgentEntry,
    effectiveShowChatPanel,
    shouldOpenConversation,
  } = resolveLocalConversationPageShellViewModel(props);

  useEffect(() => {
    if (!shouldOpenConversation) {
      return;
    }

    onHasMessagesChange?.(false);
    onAgentStreamingChange?.(false);
    onWorkflowProgressChange?.(null);
  }, [
    onHasMessagesChange,
    onAgentStreamingChange,
    onWorkflowProgressChange,
    shouldOpenConversation,
  ]);

  return (
    <AgentChatWorkspace
      {...props}
      agentEntry={effectiveAgentEntry}
      showChatPanel={effectiveShowChatPanel}
    />
  );
}
