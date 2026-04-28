import { Suspense, lazy, useEffect, useRef } from "react";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";
import {
  loadAgentChatWorkspaceModule,
  preloadAgentChatWorkspaceModule,
} from "./agentChatWorkspaceLoader";

const WORKSPACE_LOADING_FALLBACK = (
  <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
    正在准备生成工作区...
  </div>
);

const LazyAgentChatWorkspace = lazy(async () => {
  const t0 = performance.now();
  const module = await loadAgentChatWorkspaceModule();
  console.info(
    `[PERF] AgentChatWorkspace module loaded: ${(performance.now() - t0).toFixed(0)}ms`,
  );
  return { default: module.AgentChatWorkspace };
});

// 在模块加载时立即预热，避免首次进入聊天页时才触发动态 import
preloadAgentChatWorkspaceModule();

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

  // 性能埋点：记录路由进入时间
  const mountT0 = useRef<number>(performance.now());
  useEffect(() => {
    console.info(
      `[PERF] AgentChatPage mounted: ${(performance.now() - mountT0.current).toFixed(0)}ms`,
    );
  }, []);

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

  // 用首次渲染时的时间戳作为强制重挂载的 key，避免复用旧工作区实例导致旧状态闪烁
  const forcedMountKey = useRef<number | null>(
    shouldForceClawWorkspace ? Date.now() : null,
  );

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
        key={forcedMountKey.current ?? undefined}
        agentEntry={effectiveAgentEntry}
        showChatPanel={effectiveShowChatPanel}
      />
    </Suspense>
  );
}
