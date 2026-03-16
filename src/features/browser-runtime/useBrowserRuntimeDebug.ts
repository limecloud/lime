import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserEvent,
  BrowserSessionLifecycleState,
  BrowserStreamMode,
  ChromeProfileSessionInfo,
  CdpSessionState,
  CdpTargetInfo,
} from "@/lib/webview-api";
import { browserRuntimeApi } from "./api";

const MAX_CONSOLE_EVENTS = 80;
const MAX_NETWORK_EVENTS = 120;
const AUTO_RECOVERY_COOLDOWN_MS = 1500;

const RECOVERABLE_BROWSER_ERROR_PATTERNS = [
  "connection reset by peer",
  "broken pipe",
  "socket_error",
  "socket closed",
  "socket_closed",
  "读取 cdp 消息失败",
  "没有可用的 chrome profile 会话",
  "未找到 profile_key",
];

type StatusMessage = {
  type: "success" | "error";
  text: string;
};

type LatestFrameMetadata = Extract<
  BrowserEvent,
  { type: "frame_chunk" }
>["metadata"];

function appendCapped<T>(items: T[], next: T, limit: number): T[] {
  const merged = [...items, next];
  if (merged.length <= limit) {
    return merged;
  }
  return merged.slice(merged.length - limit);
}

function normalizeRuntimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecoverableBrowserError(error: unknown): boolean {
  const normalized = normalizeRuntimeErrorMessage(error).toLowerCase();
  return RECOVERABLE_BROWSER_ERROR_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

function reduceSessionStateWithEvent(
  previous: CdpSessionState | null,
  event: BrowserEvent,
): CdpSessionState | null {
  if (!previous) {
    return previous;
  }

  const nextBase: CdpSessionState = {
    ...previous,
    last_event_at: event.occurred_at,
  };

  switch (event.type) {
    case "frame_chunk":
      return {
        ...nextBase,
        last_frame_at: event.occurred_at,
      };
    case "page_info_changed":
      return {
        ...nextBase,
        target_title: event.title,
        target_url: event.url,
        last_page_info: {
          title: event.title,
          url: event.url,
          markdown: event.markdown,
          updated_at: event.occurred_at,
        },
      };
    case "session_state_changed":
      return {
        ...nextBase,
        lifecycle_state: event.lifecycle_state,
        control_mode: event.control_mode,
        human_reason: event.human_reason,
      };
    case "session_error":
      return {
        ...nextBase,
        last_error: event.error,
      };
    case "session_closed":
      return {
        ...nextBase,
        connected: false,
        lifecycle_state:
          previous.lifecycle_state === "failed" ? "failed" : "closed",
      };
    default:
      return nextBase;
  }
}

export function useBrowserRuntimeDebug(
  sessions: ChromeProfileSessionInfo[],
  onMessage?: (message: StatusMessage) => void,
  options?: {
    initialProfileKey?: string;
    initialSessionId?: string;
    initialTargetId?: string;
  },
) {
  const initialProfileKey = options?.initialProfileKey ?? "";
  const initialSessionId = options?.initialSessionId ?? "";
  const initialTargetId = options?.initialTargetId ?? "";
  const [selectedProfileKey, setSelectedProfileKey] = useState<string>("");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [targets, setTargets] = useState<CdpTargetInfo[]>([]);
  const [sessionState, setSessionState] = useState<CdpSessionState | null>(
    null,
  );
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [latestFrameMetadata, setLatestFrameMetadata] =
    useState<LatestFrameMetadata | null>(null);
  const [consoleEvents, setConsoleEvents] = useState<BrowserEvent[]>([]);
  const [networkEvents, setNetworkEvents] = useState<BrowserEvent[]>([]);
  const [_eventCursor, setEventCursor] = useState<number>(0);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [refreshingState, setRefreshingState] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const eventCursorRef = useRef<number>(0);
  const autoAttachedSessionRef = useRef<string>("");
  const autoOpenedProfileRef = useRef<string>("");
  const recoveryInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastRecoveryAtRef = useRef<number>(0);
  const lastRecoveredErrorKeyRef = useRef<string>("");
  const lastRecoveredSessionIdRef = useRef<string>("");

  useEffect(() => {
    if (!selectedTargetId && initialTargetId) {
      setSelectedTargetId(initialTargetId);
    }
  }, [initialTargetId, selectedTargetId]);

  useEffect(() => {
    const pinnedProfileKey = sessionState?.profile_key || initialProfileKey;
    if (!selectedProfileKey && pinnedProfileKey) {
      setSelectedProfileKey(pinnedProfileKey);
      return;
    }

    if (sessions.length === 0) {
      if (!initialSessionId && !sessionState?.session_id) {
        setTargets([]);
      }
      return;
    }

    if (!selectedProfileKey) {
      setSelectedProfileKey(sessions[0].profile_key);
      return;
    }

    const hasSelectedSession = sessions.some(
      (session) => session.profile_key === selectedProfileKey,
    );
    if (!hasSelectedSession && !initialSessionId && !sessionState?.session_id) {
      setSelectedProfileKey(sessions[0].profile_key);
      setTargets([]);
    }
  }, [
    initialProfileKey,
    initialSessionId,
    selectedProfileKey,
    sessionState?.profile_key,
    sessionState?.session_id,
    sessions,
  ]);

  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session.profile_key === selectedProfileKey) ||
      null,
    [selectedProfileKey, sessions],
  );

  const emitMessage = useCallback(
    (message: StatusMessage) => {
      onMessage?.(message);
    },
    [onMessage],
  );

  const applyEvent = useCallback((event: BrowserEvent) => {
    setSessionState((previous) => reduceSessionStateWithEvent(previous, event));
    if (event.type === "frame_chunk") {
      setLatestFrame(event.data);
      setLatestFrameMetadata(event.metadata);
      return;
    }
    if (event.type === "console_message") {
      setConsoleEvents((items) =>
        appendCapped(items, event, MAX_CONSOLE_EVENTS),
      );
      return;
    }
    if (
      event.type === "network_request" ||
      event.type === "network_response" ||
      event.type === "network_failed"
    ) {
      setNetworkEvents((items) =>
        appendCapped(items, event, MAX_NETWORK_EVENTS),
      );
      return;
    }
    if (event.type === "session_closed") {
      setStreaming(false);
      return;
    }
    if (event.type === "session_state_changed") {
      if (
        event.lifecycle_state === "closed" ||
        event.lifecycle_state === "failed"
      ) {
        setStreaming(false);
      }
    }
  }, []);

  const syncBuffer = useCallback(
    async (sessionId: string, cursor?: number) => {
      const snapshot = await browserRuntimeApi.getBrowserEventBuffer({
        session_id: sessionId,
        cursor,
      });
      eventCursorRef.current = snapshot.next_cursor;
      setEventCursor(snapshot.next_cursor);
      for (const event of snapshot.events) {
        applyEvent(event);
      }
      return snapshot;
    },
    [applyEvent],
  );

  const recoverBrowserSession = useCallback(
    async (reason: string) => {
      const profileKey =
        sessionState?.profile_key || selectedProfileKey || initialProfileKey;
      if (!profileKey) {
        return false;
      }

      const url =
        sessionState?.last_page_info?.url ||
        sessionState?.target_url ||
        selectedSession?.last_url ||
        "https://www.google.com/";
      const now = Date.now();

      if (recoveryInFlightRef.current) {
        return recoveryInFlightRef.current;
      }

      if (now - lastRecoveryAtRef.current < AUTO_RECOVERY_COOLDOWN_MS) {
        return false;
      }

      lastRecoveryAtRef.current = now;
      const recoveryTask = (async () => {
        setOpeningSession(true);
        setRefreshingState(true);
        setControlBusy(false);
        setConsoleEvents([]);
        setNetworkEvents([]);
        setLatestFrame(null);
        setLatestFrameMetadata(null);
        setTargets([]);
        eventCursorRef.current = 0;
        setEventCursor(0);
        setSessionState((previous) =>
          previous ? { ...previous, last_error: undefined } : previous,
        );

        try {
          const result = await browserRuntimeApi.launchBrowserSession({
            profile_key: profileKey,
            url,
            open_window: false,
            stream_mode: "both",
          });
          setSelectedProfileKey(result.session.profile_key);
          setSelectedTargetId(result.session.target_id || "");
          setSessionState(result.session);
          setStreaming(Boolean(result.session.stream_mode));
          await syncBuffer(result.session.session_id, 0);

          try {
            const nextTargets = await browserRuntimeApi.listCdpTargets(
              result.session.profile_key,
            );
            setTargets(nextTargets);
          } catch {
            setTargets([]);
          }

          emitMessage({
            type: "success",
            text: "检测到浏览器已关闭，已自动重新启动并恢复会话",
          });
          return true;
        } catch (error) {
          emitMessage({
            type: "error",
            text: `${reason}，自动恢复失败: ${normalizeRuntimeErrorMessage(error)}`,
          });
          return false;
        } finally {
          recoveryInFlightRef.current = null;
          setOpeningSession(false);
          setRefreshingState(false);
        }
      })();

      recoveryInFlightRef.current = recoveryTask;
      return recoveryTask;
    },
    [
      emitMessage,
      initialProfileKey,
      selectedProfileKey,
      selectedSession?.last_url,
      sessionState,
      syncBuffer,
    ],
  );

  const handleRecoverableError = useCallback(
    async (error: unknown, reason: string) => {
      if (!isRecoverableBrowserError(error)) {
        return false;
      }
      return recoverBrowserSession(reason);
    },
    [recoverBrowserSession],
  );

  const ensureSessionStream = useCallback(
    async (nextState: CdpSessionState, mode: BrowserStreamMode = "both") => {
      if (nextState.stream_mode) {
        setStreaming(true);
        return nextState;
      }
      const started = await browserRuntimeApi.startBrowserStream({
        session_id: nextState.session_id,
        mode,
      });
      setSessionState(started);
      setStreaming(true);
      return started;
    },
    [],
  );

  const refreshTargets = useCallback(async () => {
    if (!selectedProfileKey) return;
    setLoadingTargets(true);
    try {
      const nextTargets =
        await browserRuntimeApi.listCdpTargets(selectedProfileKey);
      setTargets(nextTargets);
      const nextSelectedTargetId =
        nextTargets.find((target) => target.id === selectedTargetId)?.id ||
        nextTargets.find((target) => target.id === initialTargetId)?.id ||
        nextTargets[0]?.id ||
        "";
      if (nextSelectedTargetId !== selectedTargetId) {
        setSelectedTargetId(nextSelectedTargetId);
      }
    } catch (error) {
      if (await handleRecoverableError(error, "检测到浏览器标签页已失效")) {
        return;
      }
      emitMessage({
        type: "error",
        text: `读取 CDP 标签页失败: ${normalizeRuntimeErrorMessage(error)}`,
      });
    } finally {
      setLoadingTargets(false);
    }
  }, [
    emitMessage,
    handleRecoverableError,
    initialTargetId,
    selectedProfileKey,
    selectedTargetId,
  ]);

  useEffect(() => {
    if (!selectedProfileKey) return;
    void refreshTargets();
  }, [refreshTargets, selectedProfileKey]);

  useEffect(() => {
    if (!initialSessionId) return;
    if (autoAttachedSessionRef.current === initialSessionId) return;
    autoAttachedSessionRef.current = initialSessionId;

    const attach = async () => {
      try {
        setRefreshingState(true);
        let nextState =
          await browserRuntimeApi.getBrowserSessionState(initialSessionId);
        setSessionState(nextState);
        setSelectedProfileKey(nextState.profile_key);
        setSelectedTargetId(nextState.target_id || initialTargetId);
        setStreaming(Boolean(nextState.stream_mode));
        nextState = await ensureSessionStream(nextState);
        await syncBuffer(nextState.session_id, 0);
      } catch (error) {
        if (await handleRecoverableError(error, "附着浏览器会话失败")) {
          return;
        }
        emitMessage({
          type: "error",
          text: `附着浏览器会话失败: ${normalizeRuntimeErrorMessage(error)}`,
        });
      } finally {
        setRefreshingState(false);
      }
    };

    void attach();
  }, [
    emitMessage,
    ensureSessionStream,
    handleRecoverableError,
    initialSessionId,
    initialTargetId,
    syncBuffer,
  ]);

  const openSession = useCallback(async () => {
    if (!selectedProfileKey) return;
    setOpeningSession(true);
    try {
      setConsoleEvents([]);
      setNetworkEvents([]);
      setLatestFrame(null);
      setLatestFrameMetadata(null);
      eventCursorRef.current = 0;
      setEventCursor(0);
      let nextState = await browserRuntimeApi.openCdpSession({
        profile_key: selectedProfileKey,
        target_id: selectedTargetId || undefined,
      });
      setSessionState(nextState);
      nextState = await ensureSessionStream(nextState);
      await syncBuffer(nextState.session_id);
      emitMessage({
        type: "success",
        text: `浏览器实时会话已连接：${nextState.target_title || nextState.target_url}`,
      });
    } catch (error) {
      if (await handleRecoverableError(error, "打开 CDP 会话失败")) {
        return;
      }
      emitMessage({
        type: "error",
        text: `打开 CDP 会话失败: ${normalizeRuntimeErrorMessage(error)}`,
      });
    } finally {
      setOpeningSession(false);
    }
  }, [
    emitMessage,
    ensureSessionStream,
    handleRecoverableError,
    selectedProfileKey,
    selectedTargetId,
    syncBuffer,
  ]);

  useEffect(() => {
    if (initialSessionId || sessionState?.session_id || openingSession) {
      return;
    }

    const profileKey = selectedProfileKey || initialProfileKey;
    if (!profileKey) {
      return;
    }

    if (!sessions.some((session) => session.profile_key === profileKey)) {
      return;
    }

    if (autoOpenedProfileRef.current === profileKey) {
      return;
    }

    autoOpenedProfileRef.current = profileKey;
    void openSession();
  }, [
    initialProfileKey,
    initialSessionId,
    openSession,
    openingSession,
    selectedProfileKey,
    sessionState?.session_id,
    sessions,
  ]);

  const refreshSessionState = useCallback(async () => {
    if (!sessionState?.session_id) return;
    setRefreshingState(true);
    try {
      const nextState = await browserRuntimeApi.getBrowserSessionState(
        sessionState.session_id,
      );
      setSessionState(nextState);
      setStreaming(Boolean(nextState.stream_mode));
      await syncBuffer(nextState.session_id, eventCursorRef.current);
    } catch (error) {
      if (await handleRecoverableError(error, "刷新浏览器会话失败")) {
        return;
      }
      emitMessage({
        type: "error",
        text: `刷新会话状态失败: ${normalizeRuntimeErrorMessage(error)}`,
      });
    } finally {
      setRefreshingState(false);
    }
  }, [emitMessage, handleRecoverableError, sessionState?.session_id, syncBuffer]);

  const startStream = useCallback(
    async (mode: BrowserStreamMode = "both") => {
      if (!sessionState?.session_id) {
        emitMessage({ type: "error", text: "请先打开 CDP 会话" });
        return;
      }
      try {
        const nextState = await browserRuntimeApi.startBrowserStream({
          session_id: sessionState.session_id,
          mode,
        });
        setSessionState(nextState);
        setStreaming(true);
        emitMessage({
          type: "success",
          text: mode === "frames" ? "已启动画面流" : "已启动浏览器事件流",
        });
      } catch (error) {
        if (await handleRecoverableError(error, "启动浏览器流失败")) {
          return;
        }
        emitMessage({
          type: "error",
          text: `启动浏览器流失败: ${normalizeRuntimeErrorMessage(error)}`,
        });
      }
    },
    [emitMessage, handleRecoverableError, sessionState],
  );

  const stopStream = useCallback(async () => {
    if (!sessionState?.session_id) return;
    try {
      const nextState = await browserRuntimeApi.stopBrowserStream(
        sessionState.session_id,
      );
      setSessionState(nextState);
      setStreaming(false);
      emitMessage({ type: "success", text: "浏览器流已停止" });
    } catch (error) {
      emitMessage({
        type: "error",
        text: `停止浏览器流失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [emitMessage, sessionState]);

  const closeSession = useCallback(async () => {
    if (!sessionState?.session_id) return;
    try {
      await browserRuntimeApi.closeCdpSession(sessionState.session_id);
      setSessionState(null);
      setStreaming(false);
      setConsoleEvents([]);
      setNetworkEvents([]);
      setLatestFrame(null);
      setLatestFrameMetadata(null);
      eventCursorRef.current = 0;
      setEventCursor(0);
      emitMessage({ type: "success", text: "CDP 会话已关闭" });
    } catch (error) {
      emitMessage({
        type: "error",
        text: `关闭 CDP 会话失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [emitMessage, sessionState]);

  const takeOverSession = useCallback(
    async (humanReason?: string) => {
      if (!sessionState?.session_id) {
        emitMessage({ type: "error", text: "当前没有可接管的浏览器会话" });
        return;
      }
      setControlBusy(true);
      try {
        let nextState = await browserRuntimeApi.takeOverBrowserSession({
          session_id: sessionState.session_id,
          human_reason: humanReason ?? "已进入人工接管",
        });
        setSessionState(nextState);
        nextState = await ensureSessionStream(nextState);
        emitMessage({ type: "success", text: "已切换为人工接管模式" });
      } catch (error) {
        emitMessage({
          type: "error",
          text: `切换人工接管失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setControlBusy(false);
      }
    },
    [emitMessage, ensureSessionStream, sessionState],
  );

  const releaseSession = useCallback(
    async (humanReason?: string) => {
      if (!sessionState?.session_id) return;
      setControlBusy(true);
      try {
        const nextState = await browserRuntimeApi.releaseBrowserSession({
          session_id: sessionState.session_id,
          human_reason: humanReason ?? "等待你确认是否继续执行",
        });
        setSessionState(nextState);
        emitMessage({ type: "success", text: "会话已保持为待继续状态" });
      } catch (error) {
        emitMessage({
          type: "error",
          text: `结束接管失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setControlBusy(false);
      }
    },
    [emitMessage, sessionState],
  );

  const resumeSession = useCallback(
    async (humanReason?: string) => {
      if (!sessionState?.session_id) return;
      setControlBusy(true);
      try {
        let nextState = await browserRuntimeApi.resumeBrowserSession({
          session_id: sessionState.session_id,
          human_reason: humanReason ?? "人工处理完成，继续执行",
        });
        setSessionState(nextState);
        nextState = await ensureSessionStream(nextState);
        emitMessage({ type: "success", text: "已交还给 Agent 继续执行" });
      } catch (error) {
        emitMessage({
          type: "error",
          text: `恢复 Agent 执行失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setControlBusy(false);
      }
    },
    [emitMessage, ensureSessionStream, sessionState],
  );

  const runDirectControlAction = useCallback(
    async (
      action: "click" | "type" | "scroll_page",
      args: Record<string, unknown>,
      successText?: string,
    ) => {
      if (!sessionState?.profile_key) {
        emitMessage({ type: "error", text: "当前没有可控制的浏览器会话" });
        return;
      }
      setControlBusy(true);
      try {
        await browserRuntimeApi.browserExecuteAction({
          profile_key: sessionState.profile_key,
          backend: "cdp_direct",
          action,
          args: {
            ...args,
            target_id: sessionState.target_id,
          },
        });
        await syncBuffer(sessionState.session_id, eventCursorRef.current);
        if (successText) {
          emitMessage({ type: "success", text: successText });
        }
      } catch (error) {
        if (await handleRecoverableError(error, "浏览器连接已断开")) {
          return;
        }
        emitMessage({
          type: "error",
          text: `发送浏览器控制指令失败: ${normalizeRuntimeErrorMessage(error)}`,
        });
      } finally {
        setControlBusy(false);
      }
    },
    [emitMessage, handleRecoverableError, sessionState, syncBuffer],
  );

  const clickAt = useCallback(
    async (x: number, y: number) => {
      await runDirectControlAction(
        "click",
        { x, y },
        `已发送点击指令 (${Math.round(x)}, ${Math.round(y)})`,
      );
    },
    [runDirectControlAction],
  );

  const scrollPage = useCallback(
    async (direction: "up" | "down", amount = 520) => {
      await runDirectControlAction("scroll_page", {
        direction,
        amount,
      });
    },
    [runDirectControlAction],
  );

  const typeIntoFocusedElement = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value) {
        return;
      }
      await runDirectControlAction(
        "type",
        { text: value },
        "已发送文本到当前焦点",
      );
    },
    [runDirectControlAction],
  );

  useEffect(() => {
    if (!sessionState?.session_id) return;
    if (!browserRuntimeApi.supportsNativeEvents()) {
      void syncBuffer(sessionState.session_id, eventCursorRef.current);
      const timer = window.setInterval(() => {
        void syncBuffer(sessionState.session_id, eventCursorRef.current);
      }, 1000);
      return () => window.clearInterval(timer);
    }
    let active = true;
    const unlistenPromise = browserRuntimeApi.listenBrowserEvent(
      ({ payload }) => {
        if (!active || payload.session_id !== sessionState.session_id) return;
        eventCursorRef.current = Math.max(
          eventCursorRef.current,
          payload.sequence,
        );
        setEventCursor((cursor) => Math.max(cursor, payload.sequence));
        applyEvent(payload);
      },
    );
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applyEvent, sessionState?.session_id, syncBuffer]);

  useEffect(() => {
    if (!sessionState?.session_id || !sessionState.last_error) {
      return;
    }
    if (!isRecoverableBrowserError(sessionState.last_error)) {
      return;
    }

    const recoveryKey = `${sessionState.session_id}:${sessionState.last_error}`;
    if (lastRecoveredErrorKeyRef.current === recoveryKey) {
      return;
    }
    lastRecoveredErrorKeyRef.current = recoveryKey;
    void recoverBrowserSession("检测到浏览器连接中断");
  }, [recoverBrowserSession, sessionState?.last_error, sessionState?.session_id]);

  useEffect(() => {
    if (!sessionState?.session_id || sessionState.connected) {
      return;
    }
    if (
      sessionState.lifecycle_state !== "failed" &&
      sessionState.lifecycle_state !== "closed"
    ) {
      return;
    }
    if (lastRecoveredSessionIdRef.current === sessionState.session_id) {
      return;
    }
    lastRecoveredSessionIdRef.current = sessionState.session_id;
    void recoverBrowserSession("检测到浏览器会话已关闭");
  }, [
    recoverBrowserSession,
    sessionState?.connected,
    sessionState?.lifecycle_state,
    sessionState?.session_id,
  ]);

  const lifecycleState: BrowserSessionLifecycleState | null =
    sessionState?.lifecycle_state ?? null;
  const isHumanControlling = lifecycleState === "human_controlling";
  const isWaitingForHuman = lifecycleState === "waiting_for_human";
  const isAgentResuming = lifecycleState === "agent_resuming";
  const canDirectControl = Boolean(sessionState && isHumanControlling);

  return {
    selectedSession,
    selectedProfileKey,
    setSelectedProfileKey,
    selectedTargetId,
    setSelectedTargetId,
    targets,
    sessionState,
    latestFrame,
    latestFrameMetadata,
    consoleEvents,
    networkEvents,
    loadingTargets,
    openingSession,
    streaming,
    refreshingState,
    controlBusy,
    lifecycleState,
    isHumanControlling,
    isWaitingForHuman,
    isAgentResuming,
    canDirectControl,
    refreshTargets,
    openSession,
    startStream,
    stopStream,
    closeSession,
    refreshSessionState,
    takeOverSession,
    releaseSession,
    resumeSession,
    clickAt,
    scrollPage,
    typeIntoFocusedElement,
  };
}
