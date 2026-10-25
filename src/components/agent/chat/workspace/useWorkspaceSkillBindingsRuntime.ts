import { useEffect, useMemo, useRef, useState } from "react";
import { listWorkspaceSkillBindings } from "@/lib/api/agentRuntime/inventoryClient";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";

interface UseWorkspaceSkillBindingsRuntimeParams {
  enabled: boolean;
  workspaceRoot?: string | null;
  deferredDelayMs?: number;
}

export interface WorkspaceSkillBindingsRuntime {
  bindings: AgentRuntimeWorkspaceSkillBinding[];
  loading: boolean;
  error: string | null;
}

const EMPTY_BINDINGS: AgentRuntimeWorkspaceSkillBinding[] = [];

export function useWorkspaceSkillBindingsRuntime({
  enabled,
  workspaceRoot,
  deferredDelayMs,
}: UseWorkspaceSkillBindingsRuntimeParams): WorkspaceSkillBindingsRuntime {
  const [bindings, setBindings] = useState<AgentRuntimeWorkspaceSkillBinding[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const normalizedWorkspaceRoot = useMemo(() => {
    const normalized = workspaceRoot?.trim();
    return normalized || null;
  }, [workspaceRoot]);

  useEffect(() => {
    if (!enabled || !normalizedWorkspaceRoot) {
      requestIdRef.current += 1;
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listWorkspaceSkillBindings({
          workspaceRoot: normalizedWorkspaceRoot,
          caller: "assistant",
          workbench: true,
        });
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }
        setBindings(result.bindings);
      } catch (loadError) {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }
        const message =
          loadError instanceof Error ? loadError.message : "读取工作区技能失败";
        setBindings([]);
        setError(message);
        console.warn(
          "[LocalConversationPage] 读取 workspace skill bindings 失败:",
          loadError,
        );
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    if (deferredDelayMs && deferredDelayMs > 0) {
      timeoutId = setTimeout(() => {
        void load();
      }, deferredDelayMs);
    } else {
      void load();
    }

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [deferredDelayMs, enabled, normalizedWorkspaceRoot]);

  const active = enabled && Boolean(normalizedWorkspaceRoot);

  return {
    bindings: active ? bindings : EMPTY_BINDINGS,
    loading: active ? loading : false,
    error: active ? error : null,
  };
}
