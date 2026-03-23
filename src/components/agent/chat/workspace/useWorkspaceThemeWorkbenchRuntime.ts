import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  executionRunGetThemeWorkbenchState,
  type ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
  type ThemeWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";
import { subscribeDocumentEditorFocus } from "@/lib/documentEditorFocusEvents";
import type { ThemeWorkbenchGateState } from "../components/Inputbar/hooks/useThemeWorkbenchInputState";
import type { ActionRequired } from "../types";
import {
  THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS,
  buildThemeWorkbenchRunStateSignature,
  inferThemeWorkbenchGateFromQueueItem,
  resolveThemeWorkbenchGateByKey,
} from "./themeWorkbenchHelpers";

type ThemeWorkbenchRuntimeState =
  | "idle"
  | "auto_running"
  | "await_user_decision";

interface UseWorkspaceThemeWorkbenchRuntimeParams {
  isThemeWorkbench: boolean;
  sessionId?: string | null;
  isSending: boolean;
  pendingActionRequest: ActionRequired | null;
}

interface ThemeWorkbenchGateBase {
  key: string;
  title: string;
  description: string;
  requiresUserDecision: boolean;
}

const IDLE_GATE: ThemeWorkbenchGateBase = {
  key: "idle",
  title: "编排待启动",
  description: "输入目标后将自动进入编排执行。",
  requiresUserDecision: false,
};

function hasFreshRunningQueueItem(
  queueItems: ThemeWorkbenchRunTodoItem[] = [],
): boolean {
  return queueItems.some((item) => {
    if (item.status !== "running") {
      return false;
    }

    const startedAt = new Date(item.started_at);
    if (Number.isNaN(startedAt.getTime())) {
      return false;
    }

    return (
      Date.now() - startedAt.getTime() <= THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
    );
  });
}

function resolveThemeWorkbenchGateBase(params: {
  isThemeWorkbench: boolean;
  pendingActionRequest: ActionRequired | null;
  themeWorkbenchBackendRunState: BackendThemeWorkbenchRunState | null;
  themeWorkbenchActiveQueueItem: ThemeWorkbenchRunTodoItem | null;
}): ThemeWorkbenchGateBase {
  const {
    isThemeWorkbench,
    pendingActionRequest,
    themeWorkbenchBackendRunState,
    themeWorkbenchActiveQueueItem,
  } = params;

  if (!isThemeWorkbench) {
    return IDLE_GATE;
  }

  if (pendingActionRequest) {
    return {
      key: pendingActionRequest.actionType,
      title: "人工闸门",
      description:
        pendingActionRequest.prompt ||
        pendingActionRequest.questions?.[0]?.question ||
        "等待你的决策以继续执行后续节点。",
      requiresUserDecision: true,
    };
  }

  if (themeWorkbenchBackendRunState?.run_state === "auto_running") {
    const backendGateKey = themeWorkbenchBackendRunState.current_gate_key;
    if (
      backendGateKey === "topic_select" ||
      backendGateKey === "write_mode" ||
      backendGateKey === "publish_confirm"
    ) {
      const backendGate = resolveThemeWorkbenchGateByKey(
        backendGateKey,
        themeWorkbenchActiveQueueItem?.title,
      );
      return {
        key: backendGate.key,
        title: backendGate.title,
        description: backendGate.description,
        requiresUserDecision: false,
      };
    }

    const inferredGate = inferThemeWorkbenchGateFromQueueItem(
      themeWorkbenchActiveQueueItem,
    );
    return {
      key: inferredGate.key,
      title: inferredGate.title,
      description: inferredGate.description,
      requiresUserDecision: false,
    };
  }

  return IDLE_GATE;
}

export function useWorkspaceThemeWorkbenchRuntime({
  isThemeWorkbench,
  sessionId,
  isSending,
  pendingActionRequest,
}: UseWorkspaceThemeWorkbenchRuntimeParams): {
  currentGate: ThemeWorkbenchGateState;
  documentEditorFocusedRef: MutableRefObject<boolean>;
  themeWorkbenchActiveQueueItem: ThemeWorkbenchRunTodoItem | null;
  themeWorkbenchBackendRunState: BackendThemeWorkbenchRunState | null;
  themeWorkbenchRunState: ThemeWorkbenchRuntimeState;
} {
  const documentEditorFocusedRef = useRef(false);
  const themeWorkbenchRunStateSignatureRef = useRef("");
  const [themeWorkbenchBackendRunState, setThemeWorkbenchBackendRunState] =
    useState<BackendThemeWorkbenchRunState | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeDocumentEditorFocus((focused) => {
      documentEditorFocusedRef.current = focused;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      themeWorkbenchRunStateSignatureRef.current = "";
      setThemeWorkbenchBackendRunState(null);
      return;
    }

    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;
    const activePollIntervalMs = isSending ? 1000 : 3000;
    const idlePollIntervalMs = isSending ? 1000 : 10000;
    const focusedPollIntervalMs = isSending ? 1000 : 15000;

    const scheduleNext = (delayMs: number) => {
      if (disposed) {
        return;
      }

      timer = window.setTimeout(() => {
        void fetchRunState();
      }, delayMs);
    };

    const fetchRunState = async () => {
      if (disposed || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const state = await executionRunGetThemeWorkbenchState(sessionId, 3);
        if (!disposed) {
          const nextSignature = buildThemeWorkbenchRunStateSignature(state);
          if (themeWorkbenchRunStateSignatureRef.current !== nextSignature) {
            themeWorkbenchRunStateSignatureRef.current = nextSignature;
            setThemeWorkbenchBackendRunState(state);
          }

          const latestTerminalRunning =
            state.latest_terminal?.status === "running";
          const hasActiveBackendRun =
            state.run_state === "auto_running" ||
            hasFreshRunningQueueItem(state.queue_items || []) ||
            latestTerminalRunning;
          scheduleNext(
            hasActiveBackendRun
              ? activePollIntervalMs
              : documentEditorFocusedRef.current
                ? focusedPollIntervalMs
                : idlePollIntervalMs,
          );
        }
      } catch (error) {
        if (!disposed) {
          console.warn("[AgentChatPage] 拉取主题工作台运行状态失败:", error);
          if (themeWorkbenchRunStateSignatureRef.current !== "null") {
            themeWorkbenchRunStateSignatureRef.current = "null";
            setThemeWorkbenchBackendRunState(null);
          }
          scheduleNext(
            documentEditorFocusedRef.current
              ? focusedPollIntervalMs
              : activePollIntervalMs,
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void fetchRunState();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isSending, isThemeWorkbench, sessionId]);

  const themeWorkbenchActiveQueueItem = useMemo(() => {
    const queueItems = themeWorkbenchBackendRunState?.queue_items || [];
    return (
      queueItems.find((item) => item.status === "running") ||
      queueItems[0] ||
      null
    );
  }, [themeWorkbenchBackendRunState?.queue_items]);

  const currentGateBase = useMemo(
    () =>
      resolveThemeWorkbenchGateBase({
        isThemeWorkbench,
        pendingActionRequest,
        themeWorkbenchBackendRunState,
        themeWorkbenchActiveQueueItem,
      }),
    [
      isThemeWorkbench,
      pendingActionRequest,
      themeWorkbenchActiveQueueItem,
      themeWorkbenchBackendRunState,
    ],
  );

  const themeWorkbenchRunState = useMemo<ThemeWorkbenchRuntimeState>(() => {
    if (!isThemeWorkbench) {
      return "idle";
    }

    if (currentGateBase.requiresUserDecision) {
      return "await_user_decision";
    }

    if (themeWorkbenchBackendRunState) {
      if (themeWorkbenchBackendRunState.run_state !== "auto_running") {
        return "idle";
      }

      return hasFreshRunningQueueItem(
        themeWorkbenchBackendRunState.queue_items || [],
      ) || isSending
        ? "auto_running"
        : "idle";
    }

    return isSending ? "auto_running" : "idle";
  }, [
    currentGateBase.requiresUserDecision,
    isSending,
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
  ]);

  const currentGate = useMemo<ThemeWorkbenchGateState>(() => {
    return {
      key: currentGateBase.key,
      title: currentGateBase.title,
      description: currentGateBase.description,
      status: currentGateBase.requiresUserDecision
        ? "waiting"
        : themeWorkbenchRunState === "auto_running"
          ? "running"
          : "idle",
    };
  }, [currentGateBase, themeWorkbenchRunState]);

  return {
    currentGate,
    documentEditorFocusedRef,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState,
    themeWorkbenchRunState,
  };
}
