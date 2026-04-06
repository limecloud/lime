import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  executionRunGetGeneralWorkbenchState,
  type GeneralWorkbenchRunState,
  type GeneralWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";
import { subscribeDocumentEditorFocus } from "@/lib/documentEditorFocusEvents";
import type { WorkflowGateState } from "../utils/workflowInputState";
import type { ActionRequired } from "../types";
import {
  GENERAL_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS,
  buildGeneralWorkbenchRunStateSignature,
  inferGeneralWorkbenchGateFromQueueItem,
  resolveGeneralWorkbenchGateByKey,
} from "./generalWorkbenchHelpers";

type WorkflowRunState = "idle" | "auto_running" | "await_user_decision";

interface UseWorkspaceGeneralWorkbenchRuntimeParams {
  isThemeWorkbench: boolean;
  sessionId?: string | null;
  isSending: boolean;
  pendingActionRequest: ActionRequired | null;
}

interface WorkflowGateBase {
  key: string;
  title: string;
  description: string;
  requiresUserDecision: boolean;
}

const IDLE_GATE: WorkflowGateBase = {
  key: "idle",
  title: "编排待启动",
  description: "输入目标后将自动进入编排执行。",
  requiresUserDecision: false,
};

function hasFreshRunningQueueItem(
  queueItems: GeneralWorkbenchRunTodoItem[] = [],
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
      Date.now() - startedAt.getTime() <= GENERAL_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
    );
  });
}

function resolveWorkflowGateBase(params: {
  isThemeWorkbench: boolean;
  pendingActionRequest: ActionRequired | null;
  themeWorkbenchBackendRunState: GeneralWorkbenchRunState | null;
  themeWorkbenchActiveQueueItem: GeneralWorkbenchRunTodoItem | null;
}): WorkflowGateBase {
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
      const backendGate = resolveGeneralWorkbenchGateByKey(
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

    const inferredGate = inferGeneralWorkbenchGateFromQueueItem(
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

export function useWorkspaceGeneralWorkbenchRuntime({
  isThemeWorkbench,
  sessionId,
  isSending,
  pendingActionRequest,
}: UseWorkspaceGeneralWorkbenchRuntimeParams): {
  currentGate: WorkflowGateState;
  documentEditorFocusedRef: MutableRefObject<boolean>;
  themeWorkbenchActiveQueueItem: GeneralWorkbenchRunTodoItem | null;
  themeWorkbenchBackendRunState: GeneralWorkbenchRunState | null;
  themeWorkbenchRunState: WorkflowRunState;
} {
  const documentEditorFocusedRef = useRef(false);
  const themeWorkbenchRunStateSignatureRef = useRef("");
  const [themeWorkbenchBackendRunState, setThemeWorkbenchBackendRunState] =
    useState<GeneralWorkbenchRunState | null>(null);

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
        const state = await executionRunGetGeneralWorkbenchState(sessionId, 3);
        if (!disposed) {
          const nextSignature = buildGeneralWorkbenchRunStateSignature(state);
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
          console.warn("[AgentChatPage] 拉取工作区编排运行状态失败:", error);
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
      resolveWorkflowGateBase({
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

  const themeWorkbenchRunState = useMemo<WorkflowRunState>(() => {
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

  const currentGate = useMemo<WorkflowGateState>(() => {
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
