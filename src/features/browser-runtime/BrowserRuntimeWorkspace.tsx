import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import {
  getChromeProfileSessions,
  type ChromeProfileSessionInfo,
} from "@/lib/webview-api";
import { BrowserEnvironmentPresetManager } from "./BrowserEnvironmentPresetManager";
import { BrowserProfileManager } from "./BrowserProfileManager";
import { BrowserRuntimeDebugPanel } from "./BrowserRuntimeDebugPanel";
import { BrowserSiteAdapterPanel } from "./BrowserSiteAdapterPanel";
import type { BrowserEnvironmentPresetRecord } from "./api";
import { getExistingSessionBridgeStatus } from "./existingSessionBridgeClient";
import type { Page, PageParams } from "@/types/page";

const MESSAGE_AUTO_HIDE_MS = 3000;
const MESSAGE_DISMISS_SUPPRESS_MS = 12000;

type RuntimeMessage = {
  type: "success" | "error";
  text: string;
};

function createMessageKey(message: RuntimeMessage) {
  return `${message.type}:${message.text}`;
}

interface BrowserRuntimeWorkspaceProps {
  standalone?: boolean;
  initialProfileKey?: string;
  initialSessionId?: string;
  initialTargetId?: string;
  initialAdapterName?: string;
  initialArgs?: Record<string, unknown>;
  initialAutoRun?: boolean;
  initialRequireAttachedSession?: boolean;
  initialSaveTitle?: string;
  currentProjectId?: string;
  currentContentId?: string;
  embedded?: boolean;
  active?: boolean;
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function BrowserRuntimeWorkspace(props: BrowserRuntimeWorkspaceProps) {
  const {
    standalone = false,
    initialProfileKey,
    initialSessionId,
    initialTargetId,
    initialAdapterName,
    initialArgs,
    initialAutoRun,
    initialRequireAttachedSession,
    initialSaveTitle,
    currentProjectId,
    currentContentId,
    embedded = false,
    active = true,
    onNavigate,
  } = props;
  const shouldActivate = standalone || embedded || active;
  const [sessions, setSessions] = useState<ChromeProfileSessionInfo[]>([]);
  const [attachObserverCount, setAttachObserverCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<RuntimeMessage | null>(null);
  const [preferredProfileKey, setPreferredProfileKey] = useState<string>("");
  const [launchEnvironmentPresetId, setLaunchEnvironmentPresetId] =
    useState<string>("");
  const [environmentPresets, setEnvironmentPresets] = useState<
    BrowserEnvironmentPresetRecord[]
  >([]);
  const messageRef = useRef<RuntimeMessage | null>(null);
  const dismissedMessageRef = useRef<{
    key: string;
    expiresAt: number;
  } | null>(null);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  const showMessage = useCallback((nextMessage: RuntimeMessage) => {
    const dismissedMessage = dismissedMessageRef.current;
    const nextMessageKey = createMessageKey(nextMessage);

    if (
      dismissedMessage &&
      dismissedMessage.key === nextMessageKey &&
      dismissedMessage.expiresAt > Date.now()
    ) {
      return;
    }

    const currentMessage = messageRef.current;
    if (currentMessage && createMessageKey(currentMessage) === nextMessageKey) {
      return;
    }

    setMessage(nextMessage);
  }, []);

  const handleDismissMessage = useCallback(() => {
    const currentMessage = messageRef.current;
    if (!currentMessage) {
      return;
    }

    dismissedMessageRef.current = {
      key: createMessageKey(currentMessage),
      expiresAt: Date.now() + MESSAGE_DISMISS_SUPPRESS_MS,
    };
    setMessage(null);
  }, []);

  const refreshSessions = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true);
      }
      try {
        const [nextSessions, nextBridgeStatus] = await Promise.all([
          getChromeProfileSessions(),
          getExistingSessionBridgeStatus(),
        ]);
        setSessions(nextSessions);
        setAttachObserverCount(nextBridgeStatus?.observer_count ?? 0);
      } catch (error) {
        showMessage({
          type: "error",
          text: `刷新浏览器会话失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        if (!silent) {
          setRefreshing(false);
        }
      }
    },
    [showMessage],
  );

  useEffect(() => {
    if (!shouldActivate) {
      return;
    }

    void refreshSessions(true);
    const pollInterval =
      initialSessionId || initialProfileKey || embedded ? 1500 : 15000;
    const timer = window.setInterval(() => {
      void refreshSessions(true);
    }, pollInterval);
    return () => window.clearInterval(timer);
  }, [
    embedded,
    initialProfileKey,
    initialSessionId,
    refreshSessions,
    shouldActivate,
  ]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(null),
      MESSAGE_AUTO_HIDE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (
      launchEnvironmentPresetId &&
      !environmentPresets.some(
        (preset) => preset.id === launchEnvironmentPresetId,
      )
    ) {
      setLaunchEnvironmentPresetId("");
    }
  }, [environmentPresets, launchEnvironmentPresetId]);

  if (!shouldActivate) {
    return null;
  }

  const rootClassName = standalone
    ? "min-h-screen bg-background p-6 space-y-4"
    : embedded
      ? "relative flex h-full min-h-0 flex-col bg-background"
      : "space-y-4";
  const messageClassName = embedded
    ? `absolute left-3 right-3 top-3 z-20 rounded-xl border px-3 py-2.5 text-sm shadow-lg shadow-slate-950/10 backdrop-blur ${
        message?.type === "error"
          ? "border-destructive bg-destructive/95 text-destructive-foreground"
          : "border-green-500 bg-green-600/95 text-white"
      }`
    : `rounded-md border px-3 py-2 text-sm ${
        message?.type === "error"
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
      }`;

  return (
    <div className={rootClassName}>
      {!embedded ? (
        <div className="rounded-lg border p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">浏览器实时会话</h2>
              <p className="text-sm text-muted-foreground">
                统一管理实时画面、人工接管、会话状态与高级调试信息。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshSessions(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              刷新会话
            </button>
          </div>

          <div className="text-xs text-muted-foreground">
            当前运行 Profile：
            <span className="ml-1 font-medium text-foreground">
              {sessions.length}
            </span>
            个
            <span className="ml-4">
              当前附着 Chrome：
              <span className="ml-1 font-medium text-foreground">
                {attachObserverCount}
              </span>
              个
            </span>
          </div>
          {attachObserverCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              附着当前 Chrome
              会优先复用你正在使用的浏览器页面，并在可用时直接接管到实时调试会话。
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div className={messageClassName} role="alert">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 leading-5">{message.text}</div>
            <button
              type="button"
              onClick={handleDismissMessage}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current/80 transition hover:bg-black/10 hover:text-current"
              aria-label="关闭消息"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {!embedded ? (
        <BrowserProfileManager
          onMessage={showMessage}
          onProfileLaunched={(profileKey) => {
            setPreferredProfileKey(profileKey);
            void refreshSessions(true);
          }}
          launchEnvironmentPresetId={launchEnvironmentPresetId}
          launchEnvironmentPresetOptions={environmentPresets}
          onLaunchEnvironmentPresetChange={setLaunchEnvironmentPresetId}
        />
      ) : null}

      {!embedded ? (
        <BrowserEnvironmentPresetManager
          onMessage={showMessage}
          selectedPresetId={launchEnvironmentPresetId}
          onSelectedPresetChange={setLaunchEnvironmentPresetId}
          onPresetsChanged={setEnvironmentPresets}
        />
      ) : null}

      {!embedded ? (
        <BrowserSiteAdapterPanel
          selectedProfileKey={preferredProfileKey || initialProfileKey}
          onMessage={showMessage}
          variant="workspace"
          onNavigate={onNavigate}
          currentProjectId={currentProjectId}
          currentContentId={currentContentId}
          initialAdapterName={initialAdapterName}
          initialArgs={initialArgs}
          initialAutoRun={initialAutoRun}
          initialRequireAttachedSession={initialRequireAttachedSession}
          initialSaveTitle={initialSaveTitle}
        />
      ) : null}

      <div className={embedded ? "min-h-0 flex-1" : undefined}>
        <BrowserRuntimeDebugPanel
          key={
            preferredProfileKey || initialProfileKey || initialSessionId
              ? `browser-runtime:${preferredProfileKey || initialProfileKey || initialSessionId}`
              : "browser-runtime:default"
          }
          sessions={sessions}
          onMessage={showMessage}
          showStandaloneWindowButton={!standalone}
          showSiteAdapterPanel={embedded}
          initialProfileKey={preferredProfileKey || initialProfileKey}
          initialSessionId={initialSessionId}
          initialTargetId={initialTargetId}
          embedded={embedded}
        />
      </div>
    </div>
  );
}
