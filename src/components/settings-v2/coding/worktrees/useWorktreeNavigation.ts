import { useEffect, useRef, useState } from "react";
import {
  createAgentRuntimeSession,
  getAgentRuntimeSession,
} from "@/lib/api/agentRuntime/sessionClient";
import { buildConversationParams } from "@/lib/workspace/navigation";
import { requestExplicitInitialSessionNavigation } from "@/components/agent/chat/workspace/useWorkspaceInitialSessionNavigation";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";

export interface WorktreeNavigationProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function useWorktreeNavigation({ onNavigate }: WorktreeNavigationProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [destination, setDestination] = useState<AgentPageParams | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useSettingsDraft({ dirty: false, saving: pending !== null });

  useEffect(
    () => () => {
      ++generation.current;
    },
    [],
  );
  useEffect(() => {
    if (!destination || !onNavigate) return;
    // layout effect 已释放本操作的 saving guard；其他草稿仍由 App 导航保护。
    setDestination(null);
    requestExplicitInitialSessionNavigation(destination.initialSessionId!);
    onNavigate("agent", destination);
  }, [destination, onNavigate]);

  async function open(worktreePath: string, threadId?: string) {
    if (!onNavigate || inFlight.current) return;
    inFlight.current = true;
    const request = generation.current;
    setPending(worktreePath);
    setFailed(null);
    try {
      // Thread 与 Session 的身份由 canonical read 映射，不以 Thread ID 代替 Session ID。
      const session = threadId
        ? await getAgentRuntimeSession(threadId, {
            historyLimit: 1,
            source: "worktree-settings",
          })
        : {
            id: await createAgentRuntimeSession(
              undefined,
              undefined,
              undefined,
              {
                workingDir: worktreePath,
              },
            ),
          };
      if (!session.id?.trim())
        throw new Error("Missing canonical session identity");
      if (request === generation.current) {
        setDestination(buildConversationParams({ initialSessionId: session.id }));
      }
    } catch {
      if (request === generation.current) setFailed(worktreePath);
    } finally {
      inFlight.current = false;
      if (request === generation.current) setPending(null);
    }
  }

  return { open, pending, failed, available: Boolean(onNavigate) };
}
