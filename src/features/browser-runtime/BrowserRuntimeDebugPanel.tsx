import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent,
} from "react";
import {
  Bug,
  ExternalLink,
  Globe,
  Hand,
  Pause,
  Play,
  RefreshCw,
  Send,
} from "lucide-react";
import type {
  BrowserRuntimeAuditRecord,
  ChromeProfileSessionInfo,
} from "@/lib/webview-api";
import { browserRuntimeApi } from "./api";
import { BrowserSiteAdapterPanel } from "./BrowserSiteAdapterPanel";
import { getExistingSessionTabLabel } from "./existingSessionBridge";
import { useExistingSessionAttachPanel } from "./useExistingSessionAttachPanel";
import { useBrowserRuntimeDebug } from "./useBrowserRuntimeDebug";

interface BrowserRuntimeDebugPanelProps {
  sessions: ChromeProfileSessionInfo[];
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  showStandaloneWindowButton?: boolean;
  showSiteAdapterPanel?: boolean;
  initialProfileKey?: string;
  initialSessionId?: string;
  initialTargetId?: string;
  embedded?: boolean;
}

function formatEventSubtitle(event: {
  type: string;
  occurred_at: string;
  text?: string;
  url?: string;
  status?: number;
}) {
  if (event.type === "console_message") {
    return event.text || "";
  }
  if (event.type === "network_response") {
    return `${event.status || "-"} · ${event.url || ""}`;
  }
  if (event.type === "network_request") {
    return event.url || "";
  }
  return event.occurred_at;
}

function resolveSessionStatus(
  sessionState: {
    connected: boolean;
    lifecycle_state: string;
    human_reason?: string;
    last_error?: string;
  } | null,
) {
  if (!sessionState) {
    return {
      label: "未连接",
      toneClass: "border-border/70 bg-muted/40 text-muted-foreground",
      description: "还没有附着到浏览器实时会话。",
    };
  }

  switch (sessionState.lifecycle_state) {
    case "human_controlling":
      return {
        label: "你正在接管",
        toneClass:
          "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200",
        description:
          sessionState.human_reason || "当前画布已切换为人工处理模式。",
      };
    case "waiting_for_human":
      return {
        label: "等待你处理",
        toneClass:
          "border-orange-300/70 bg-orange-50 text-orange-800 dark:border-orange-800/70 dark:bg-orange-950/30 dark:text-orange-200",
        description:
          sessionState.human_reason || "Agent 已停在当前页面，等待你介入处理。",
      };
    case "agent_resuming":
      return {
        label: "恢复中",
        toneClass:
          "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/30 dark:text-sky-200",
        description:
          sessionState.human_reason || "浏览器会话正在交回给 Agent。",
      };
    case "failed":
      return {
        label: "会话失败",
        toneClass: "border-destructive/60 bg-destructive/10 text-destructive",
        description:
          sessionState.last_error || "浏览器连接已异常中断，请刷新或重新连接。",
      };
    case "closed":
      return {
        label: "已关闭",
        toneClass: "border-border/70 bg-muted/40 text-muted-foreground",
        description: "实时会话已经关闭。",
      };
    case "launching":
      return {
        label: "连接中",
        toneClass:
          "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/30 dark:text-sky-200",
        description: "浏览器实时会话正在建立连接。",
      };
    default:
      return {
        label: sessionState.connected ? "执行中" : "未连接",
        toneClass:
          "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200",
        description: "Agent 正在当前浏览器会话中执行任务。",
      };
  }
}

function resolveFrameCoordinate(params: {
  clientX: number;
  clientY: number;
  rect: DOMRect;
  frameWidth?: number;
  frameHeight?: number;
}) {
  const { clientX, clientY, rect, frameWidth, frameHeight } = params;
  if (!frameWidth || !frameHeight || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const frameAspect = frameWidth / frameHeight;
  const containerAspect = rect.width / rect.height;
  let renderedWidth = rect.width;
  let renderedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (frameAspect > containerAspect) {
    renderedHeight = rect.width / frameAspect;
    offsetY = (rect.height - renderedHeight) / 2;
  } else {
    renderedWidth = rect.height * frameAspect;
    offsetX = (rect.width - renderedWidth) / 2;
  }

  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (
    localX < 0 ||
    localY < 0 ||
    localX > renderedWidth ||
    localY > renderedHeight
  ) {
    return null;
  }

  return {
    x: (localX / renderedWidth) * frameWidth,
    y: (localY / renderedHeight) * frameHeight,
  };
}

function resolveLiveViewPlaceholder(params: {
  sessionCount: number;
  hasAttachIntent: boolean;
  openingSession: boolean;
  refreshingState: boolean;
  sessionState: {
    connected: boolean;
    lifecycle_state: string;
  } | null;
}) {
  const {
    sessionCount,
    hasAttachIntent,
    openingSession,
    refreshingState,
    sessionState,
  } = params;

  if (sessionCount === 0 && !hasAttachIntent) {
    return "还没有运行中的浏览器会话。请先在通用对话里启动浏览器协助。";
  }

  if (openingSession || refreshingState) {
    return "正在启动 Chrome、连接调试通道，通常需要 3–8 秒。";
  }

  if (sessionState) {
    return "已连接浏览器，正在等待首帧画面。若超过 10 秒仍无画面，可点击“恢复画面”或刷新会话。";
  }

  return "正在连接浏览器会话...";
}

function summarizePageMarkdown(markdown: string, maxLines = 6) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  return `${lines.slice(0, maxLines).join("\n")}\n...`;
}

function formatAuditTime(value: string) {
  const time = value.split("T")[1];
  if (!time) {
    return value;
  }
  return time.replace("Z", "").slice(0, 8);
}

function describeAuditRecord(record: BrowserRuntimeAuditRecord) {
  if (record.kind === "launch") {
    return {
      title: record.success ? "启动成功" : "启动失败",
      subject:
        record.url || record.session_id || record.target_id || "未记录目标",
      meta: [
        record.environment_preset_name,
        record.reused === undefined
          ? undefined
          : record.reused
            ? "复用会话"
            : "新建会话",
        record.browser_source,
        record.remote_debugging_port
          ? `CDP ${record.remote_debugging_port}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    title: record.action ? `动作 · ${record.action}` : "动作审计",
    subject: record.profile_key || record.session_id || "未记录资料",
    meta: [
      record.selected_backend || record.requested_backend,
      record.attempts?.length ? `${record.attempts.length} 次尝试` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function BrowserRuntimeDebugPanel(props: BrowserRuntimeDebugPanelProps) {
  const {
    sessions,
    onMessage,
    showStandaloneWindowButton = true,
    showSiteAdapterPanel = true,
    initialProfileKey,
    initialSessionId,
    initialTargetId,
    embedded = false,
  } = props;
  const runtime = useBrowserRuntimeDebug(sessions, onMessage, {
    initialProfileKey,
    initialSessionId,
    initialTargetId,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [auditLogs, setAuditLogs] = useState<BrowserRuntimeAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const liveViewRef = useRef<HTMLDivElement | null>(null);
  const {
    activeAttachProfileKey,
    attachProfile,
    attachObserver,
    attachContextLoading,
    attachPageLoading,
    attachTabsLoading,
    attachTabs,
    switchingAttachTabId,
    attachPageInfo,
    shouldUseAttachPresentation,
    attachPresentation,
    loadAttachContext,
    loadAttachPage,
    loadAttachTabs,
    handleSwitchAttachTab,
  } = useExistingSessionAttachPanel({
    selectedProfileKey: runtime.selectedProfileKey,
    initialProfileKey,
    sessionState: runtime.sessionState,
    onMessage,
  });
  const preferRuntimeLivePresentation =
    runtime.isExistingSessionProfile &&
    !runtime.runtimeConnectionError &&
    Boolean(
      runtime.sessionState ||
        runtime.openingSession ||
        runtime.refreshingState ||
        runtime.selectedSession,
    );
  const showAttachPresentation =
    shouldUseAttachPresentation && !preferRuntimeLivePresentation;

  const currentTitle =
    runtime.sessionState?.last_page_info?.title ||
    runtime.sessionState?.target_title ||
    attachPageInfo?.title ||
    attachProfile?.name ||
    (showAttachPresentation ? "附着当前 Chrome" : "未打开会话");
  const currentUrl =
    runtime.sessionState?.last_page_info?.url ||
    runtime.sessionState?.target_url ||
    attachPageInfo?.url ||
    runtime.selectedSession?.last_url ||
    "";
  const statusInfo = useMemo(
    () =>
      showAttachPresentation
        ? attachPresentation.statusInfo
        : resolveSessionStatus(runtime.sessionState),
    [
      attachPresentation.statusInfo,
      runtime.sessionState,
      showAttachPresentation,
    ],
  );
  const hasAttachIntent = Boolean(
    runtime.sessionState ||
    runtime.selectedProfileKey ||
    initialProfileKey ||
    initialSessionId,
  );
  const compactActionButtonClass =
    "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted disabled:opacity-60";
  const embeddedIconButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-border/70 bg-background/90 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60";
  const embeddedPrimaryButtonClass =
    "inline-flex h-8 items-center gap-1 rounded-[10px] border px-2.5 text-xs font-medium transition-colors disabled:opacity-60";
  const showEmbeddedControlTray =
    runtime.canDirectControl ||
    runtime.isWaitingForHuman ||
    runtime.isHumanControlling ||
    showAdvanced;
  const auditProfileKey =
    runtime.sessionState?.profile_key ||
    runtime.selectedProfileKey ||
    initialProfileKey ||
    "";
  const auditSessionId = runtime.sessionState?.session_id || "";
  const liveViewPlaceholder = resolveLiveViewPlaceholder({
    sessionCount: sessions.length,
    hasAttachIntent,
    openingSession: runtime.openingSession,
    refreshingState: runtime.refreshingState,
    sessionState: runtime.sessionState,
  });
  const effectiveLiveViewPlaceholder = showAttachPresentation
    ? attachPresentation.placeholder
    : liveViewPlaceholder;
  const visibleAuditLogs = useMemo(() => {
    const filtered = auditLogs.filter((record) => {
      if (auditSessionId && record.session_id === auditSessionId) {
        return true;
      }
      if (auditProfileKey && record.profile_key === auditProfileKey) {
        return true;
      }
      return false;
    });
    return (filtered.length > 0 ? filtered : auditLogs).slice(0, 6);
  }, [auditLogs, auditProfileKey, auditSessionId]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const logs = await browserRuntimeApi.getBrowserRuntimeAuditLogs(16);
      setAuditLogs(logs);
    } catch (error) {
      onMessage?.({
        type: "error",
        text: `读取浏览器审计失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setAuditLoading(false);
    }
  }, [onMessage]);

  useEffect(() => {
    if (!showAdvanced) {
      return;
    }
    void loadAuditLogs();
  }, [showAdvanced, loadAuditLogs, auditProfileKey, auditSessionId]);

  const renderAuditPanel = (maxHeightClass: string) => (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">最近启动与动作审计</div>
          <div className="text-[11px] text-muted-foreground">
            当前收口到统一浏览器运行时审计，便于排查启动链与动作链。
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
          onClick={() => void loadAuditLogs()}
          disabled={auditLoading}
        >
          <RefreshCw
            className={`h-3 w-3 ${auditLoading ? "animate-spin" : ""}`}
          />
          刷新
        </button>
      </div>
      <div className={`space-y-2 overflow-auto text-xs ${maxHeightClass}`}>
        {auditLoading && visibleAuditLogs.length === 0 ? (
          <div className="text-muted-foreground">正在读取最近审计...</div>
        ) : visibleAuditLogs.length === 0 ? (
          <div className="text-muted-foreground">暂无最近启动或动作审计</div>
        ) : (
          visibleAuditLogs.map((record) => {
            const description = describeAuditRecord(record);
            return (
              <div
                key={record.id}
                className={`rounded border p-2 ${
                  record.success
                    ? "border-border/80"
                    : "border-destructive/40 bg-destructive/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground/90">
                    {description.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatAuditTime(record.created_at)}
                  </div>
                </div>
                <div className="mt-1 break-all text-muted-foreground">
                  {description.subject}
                </div>
                {description.meta ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {description.meta}
                  </div>
                ) : null}
                {record.error ? (
                  <div className="mt-1 text-[11px] text-destructive">
                    {record.error}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderAttachTabsPanel = (maxHeightClass: string) => (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">当前窗口标签页</div>
          <div className="text-[11px] text-muted-foreground">
            直接读取你当前 Chrome 窗口里的标签页，并切换到目标页面。
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
          onClick={() => void loadAttachTabs()}
          disabled={attachTabsLoading || !attachObserver}
        >
          <RefreshCw
            className={`h-3 w-3 ${attachTabsLoading ? "animate-spin" : ""}`}
          />
          {attachTabsLoading ? "读取中..." : "读取标签页"}
        </button>
      </div>

      <div className={`space-y-2 overflow-auto text-xs ${maxHeightClass}`}>
        {!attachObserver ? (
          <div className="text-muted-foreground">
            未检测到当前 Chrome 的桥接 observer，请先连接 Lime Browser
            Bridge。
          </div>
        ) : attachTabs.length === 0 ? (
          <div className="text-muted-foreground">
            点击“读取标签页”同步当前窗口的标签页列表。
          </div>
        ) : (
          attachTabs.map((tab) => {
            const tabKey = `${activeAttachProfileKey}:${tab.id}`;
            return (
              <div
                key={tabKey}
                className={`rounded border p-2 ${
                  tab.active
                    ? "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                    : "border-border/80"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/90">
                      {getExistingSessionTabLabel(tab)}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {tab.url || "未记录 URL"}
                    </div>
                  </div>
                  {tab.active ? (
                    <span className="rounded-full border border-emerald-300/70 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                      当前标签页
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
                      onClick={() => void handleSwitchAttachTab(tab)}
                      disabled={switchingAttachTabId === tab.id}
                    >
                      {switchingAttachTabId === tab.id
                        ? "切换中..."
                        : "切换到此页"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderAttachFallbackPanel = (maxHeightClass: string) => (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">附着当前 Chrome</div>
            <div className="text-[11px] text-muted-foreground">
              当前资料不创建独立 CDP 会话，直接复用你正在使用的浏览器与登录态。
            </div>
          </div>
          <div
            className={`rounded-full border px-2 py-1 text-[11px] font-medium ${statusInfo.toneClass}`}
          >
            {statusInfo.label}
          </div>
        </div>

        <div className="grid gap-2 text-xs md:grid-cols-2">
          <div>
            <span className="text-muted-foreground">资料：</span>
            <span>{attachProfile?.name || activeAttachProfileKey || "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Profile Key：</span>
            <span className="break-all">{activeAttachProfileKey || "-"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Observer：</span>
            <span>{attachObserver?.client_id || "未连接"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">最后心跳：</span>
            <span>{attachObserver?.last_heartbeat_at || "-"}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            onClick={() => void loadAttachContext()}
            disabled={attachContextLoading}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                attachContextLoading ? "animate-spin" : ""
              }`}
            />
            {attachContextLoading ? "刷新中..." : "刷新桥接状态"}
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            onClick={() => void loadAttachPage()}
            disabled={attachPageLoading || !attachObserver}
          >
            {attachPageLoading ? "读取中..." : "读取当前页面"}
          </button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">当前页面摘要</div>
            <div className="text-[11px] text-muted-foreground">
              标题、URL 与 Markdown 摘要来自当前 Chrome 扩展桥接。
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {attachPageInfo?.updated_at
              ? formatAuditTime(attachPageInfo.updated_at)
              : "未同步"}
          </div>
        </div>

        {!attachObserver ? (
          <div className="text-xs text-muted-foreground">
            连接扩展桥接后，这里会显示当前标签页的页面摘要。
          </div>
        ) : attachPageInfo ? (
          <div className="space-y-2 text-xs">
            <div>
              <div className="text-[11px] text-muted-foreground">标题</div>
              <div className="break-all text-foreground/90">
                {attachPageInfo.title || "未记录标题"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">URL</div>
              <div className="break-all text-muted-foreground">
                {attachPageInfo.url || "未记录 URL"}
              </div>
            </div>
            {attachPageInfo.markdown ? (
              <div className="rounded-md bg-muted/35 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                {summarizePageMarkdown(attachPageInfo.markdown)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            点击“读取当前页面”同步当前标签页的标题、URL 和页面摘要。
          </div>
        )}
      </div>

      {renderAttachTabsPanel(maxHeightClass)}
    </div>
  );

  const handleOpenStandaloneWindow = async () => {
    try {
      await browserRuntimeApi.openBrowserRuntimeDebuggerWindow({
        session_id: runtime.sessionState?.session_id,
        profile_key:
          runtime.sessionState?.profile_key ||
          runtime.selectedProfileKey ||
          initialProfileKey,
      });
      onMessage?.({
        type: "success",
        text: "已打开独立浏览器实时会话窗口",
      });
    } catch (error) {
      onMessage?.({
        type: "error",
        text: `打开独立实时会话窗口失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  };

  const handleOpenSystemBrowser = async () => {
    const profileKey =
      runtime.sessionState?.profile_key ||
      runtime.selectedProfileKey ||
      initialProfileKey;
    if (!profileKey || !currentUrl) {
      onMessage?.({
        type: "error",
        text: "当前没有可打开的浏览器页面",
      });
      return;
    }

    try {
      await browserRuntimeApi.reopenProfileWindow({
        profile_key: profileKey,
        url: currentUrl,
      });
      onMessage?.({
        type: "success",
        text: "已在独立 Chrome 会话中打开当前页面",
      });
    } catch (error) {
      onMessage?.({
        type: "error",
        text: `打开系统浏览器失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  };

  const handleLiveViewClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!runtime.canDirectControl || runtime.controlBusy) {
      return;
    }
    const rect = liveViewRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const point = resolveFrameCoordinate({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      frameWidth: runtime.latestFrameMetadata?.width,
      frameHeight: runtime.latestFrameMetadata?.height,
    });
    if (!point) {
      return;
    }
    await runtime.clickAt(point.x, point.y);
  };

  const handleLiveViewWheel = async (event: WheelEvent<HTMLDivElement>) => {
    if (!runtime.canDirectControl || runtime.controlBusy) {
      return;
    }
    event.preventDefault();
    await runtime.scrollPage(event.deltaY < 0 ? "up" : "down");
  };

  const handleSendManualInput = async () => {
    const value = manualInput.trim();
    if (!value) {
      return;
    }
    await runtime.typeIntoFocusedElement(value);
    setManualInput("");
  };

  if (embedded) {
    const embeddedAction = showAttachPresentation ? (
      <button
        type="button"
        className={embeddedPrimaryButtonClass}
        onClick={() =>
          void (attachPresentation.observerConnected
            ? loadAttachPage()
            : loadAttachContext())
        }
        disabled={attachPageLoading || attachContextLoading}
      >
        {attachPresentation.embeddedActionLabel}
      </button>
    ) : !runtime.sessionState ? (
      <button
        type="button"
        className={embeddedPrimaryButtonClass}
        onClick={() => void runtime.openSession()}
        disabled={runtime.openingSession || !runtime.selectedProfileKey}
      >
        {runtime.openingSession ? "连接中" : "连接"}
      </button>
    ) : runtime.isHumanControlling ? (
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-emerald-300/70 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200"
        onClick={() => void runtime.resumeSession()}
        disabled={runtime.controlBusy}
      >
        <Play className="h-3.5 w-3.5" />
        {runtime.controlBusy ? "处理中" : "继续"}
      </button>
    ) : runtime.isWaitingForHuman ? (
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-amber-300/70 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
        onClick={() => void runtime.takeOverSession()}
        disabled={runtime.controlBusy}
      >
        <Hand className="h-3.5 w-3.5" />
        处理
      </button>
    ) : (
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-amber-300/70 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
        onClick={() => void runtime.takeOverSession()}
        disabled={runtime.controlBusy || runtime.isAgentResuming}
      >
        <Hand className="h-3.5 w-3.5" />
        {runtime.isAgentResuming ? "恢复中" : "接管"}
      </button>
    );

    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/15 px-3 py-2">
          <div className="hidden items-center gap-1.5 md:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="min-w-0 flex-1 rounded-[12px] border border-border/70 bg-background/95 px-3 py-1.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  runtime.sessionState?.connected
                    ? runtime.isHumanControlling
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                    : "bg-muted-foreground/50"
                }`}
              />
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-[12px] text-foreground/90">
                {currentUrl || "正在准备浏览器会话..."}
              </span>
            </div>
          </div>
          <div
            className={`hidden rounded-full border px-2 py-1 text-[11px] font-medium lg:block ${statusInfo.toneClass}`}
          >
            {statusInfo.label}
          </div>
          {embeddedAction}
          <button
            type="button"
            className={embeddedIconButtonClass}
            onClick={() =>
              void (showAttachPresentation
                ? loadAttachContext()
                : runtime.refreshSessionState())
            }
            disabled={
              showAttachPresentation
                ? attachContextLoading
                : runtime.refreshingState || !runtime.sessionState
            }
            aria-label={showAttachPresentation ? "刷新桥接" : "刷新会话"}
            title={showAttachPresentation ? "刷新桥接" : "刷新会话"}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                showAttachPresentation
                  ? attachContextLoading
                    ? "animate-spin"
                    : ""
                  : runtime.refreshingState
                    ? "animate-spin"
                    : ""
              }`}
            />
          </button>
          {showStandaloneWindowButton ? (
            <button
              type="button"
              className={embeddedIconButtonClass}
              onClick={() => void handleOpenStandaloneWindow()}
              aria-label="独立窗口"
              title="独立窗口"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className={embeddedIconButtonClass}
            onClick={() => setShowAdvanced((value) => !value)}
            aria-label={showAdvanced ? "收起调试" : "展开调试"}
            title={showAdvanced ? "收起调试" : "展开调试"}
          >
            <Bug className="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          ref={liveViewRef}
          className={`relative min-h-0 flex-1 overflow-hidden bg-black/95 ${
            runtime.canDirectControl ? "cursor-crosshair" : "cursor-default"
          }`}
          onClick={(event) => void handleLiveViewClick(event)}
          onWheel={(event) => void handleLiveViewWheel(event)}
        >
          {runtime.latestFrame ? (
            <img
              src={`data:image/jpeg;base64,${runtime.latestFrame}`}
              alt="browser-live-view"
              className="absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/75">
              {effectiveLiveViewPlaceholder}
            </div>
          )}

          <div className="absolute left-3 top-3 max-w-[min(60%,24rem)] rounded-full bg-black/55 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur">
            <span className="truncate">{currentTitle}</span>
          </div>

          {runtime.sessionState?.last_error ? (
            <div className="absolute bottom-3 left-3 right-3 rounded-md bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground shadow-sm">
              {runtime.sessionState.last_error}
            </div>
          ) : showEmbeddedControlTray ? (
            <div className="absolute bottom-3 left-3 right-3 rounded-full bg-black/55 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur">
              {showAttachPresentation
                ? attachPresentation.embeddedControlHint
                : runtime.canDirectControl
                  ? "已接管：可以直接点击画面、滚轮滚动，并向当前焦点输入文本。"
                  : runtime.isWaitingForHuman
                    ? "Agent 正在等待你接管当前页面。"
                    : runtime.isHumanControlling
                      ? "人工处理中，可随时继续交回给 Agent。"
                      : "实时会话已附着。"}
            </div>
          ) : null}
        </div>

        {showEmbeddedControlTray ? (
          <div className="border-t border-border/70 bg-background/95 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {runtime.isHumanControlling ? (
                <button
                  type="button"
                  className={compactActionButtonClass}
                  onClick={() => void runtime.releaseSession()}
                  disabled={runtime.controlBusy}
                >
                  <Pause className="h-3.5 w-3.5" />
                  结束接管
                </button>
              ) : null}
              {runtime.isWaitingForHuman ? (
                <button
                  type="button"
                  className={compactActionButtonClass}
                  onClick={() =>
                    void runtime.resumeSession("无需人工处理，继续执行")
                  }
                  disabled={runtime.controlBusy}
                >
                  <Play className="h-3.5 w-3.5" />
                  继续执行
                </button>
              ) : null}
              {runtime.sessionState ? (
                <button
                  type="button"
                  className={compactActionButtonClass}
                  onClick={() =>
                    void (runtime.streaming
                      ? runtime.stopStream()
                      : runtime.startStream("both"))
                  }
                >
                  {runtime.streaming ? "停止画面" : "恢复画面"}
                </button>
              ) : null}
              {showAttachPresentation ? (
                <button
                  type="button"
                  className={compactActionButtonClass}
                  onClick={() => void loadAttachTabs()}
                  disabled={
                    attachTabsLoading || !attachPresentation.observerConnected
                  }
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      attachTabsLoading ? "animate-spin" : ""
                    }`}
                  />
                  {attachPresentation.tabsActionLabel}
                </button>
              ) : null}
              {showAdvanced ? (
                <button
                  type="button"
                  className={compactActionButtonClass}
                  onClick={() =>
                    void (showAttachPresentation
                      ? loadAttachPage()
                      : handleOpenSystemBrowser())
                  }
                  disabled={
                    showAttachPresentation
                      ? attachPageLoading ||
                        !attachPresentation.observerConnected
                      : !currentUrl
                  }
                >
                  <Globe className="h-3.5 w-3.5" />
                  {showAttachPresentation
                    ? attachPresentation.pageActionLabel
                    : "在 Chrome 中继续"}
                </button>
              ) : null}
            </div>

            {runtime.canDirectControl ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="h-8 w-full min-w-0 flex-1 rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[220px]"
                  placeholder="向当前焦点输入文本"
                  value={manualInput}
                  disabled={runtime.controlBusy}
                  onChange={(event) => setManualInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSendManualInput();
                    }
                  }}
                />
                <button
                  type="button"
                  className={compactActionButtonClass}
                  disabled={runtime.controlBusy}
                  onClick={() => void handleSendManualInput()}
                >
                  <Send className="h-3.5 w-3.5" />
                  发送
                </button>
                <button
                  type="button"
                  className={compactActionButtonClass}
                  disabled={runtime.controlBusy}
                  onClick={() => void runtime.scrollPage("up")}
                >
                  上滚
                </button>
                <button
                  type="button"
                  className={compactActionButtonClass}
                  disabled={runtime.controlBusy}
                  onClick={() => void runtime.scrollPage("down")}
                >
                  下滚
                </button>
              </div>
            ) : null}

            {showAdvanced ? (
              <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
                {showAttachPresentation ? (
                  <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                    <div>{renderAttachFallbackPanel("max-h-[180px]")}</div>
                    <div>{renderAuditPanel("max-h-[180px]")}</div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">
                          Profile 会话
                        </span>
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={runtime.selectedProfileKey}
                          onChange={(event) =>
                            runtime.setSelectedProfileKey(event.target.value)
                          }
                        >
                          {sessions.map((session) => (
                            <option
                              key={session.profile_key}
                              value={session.profile_key}
                            >
                              {session.profile_key} · PID {session.pid || "-"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">
                          CDP 标签页
                        </span>
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={runtime.selectedTargetId}
                          onChange={(event) =>
                            runtime.setSelectedTargetId(event.target.value)
                          }
                        >
                          {runtime.targets.length === 0 ? (
                            <option value="">未发现标签页</option>
                          ) : (
                            runtime.targets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.title || target.url || target.id}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={compactActionButtonClass}
                        onClick={() => void runtime.refreshTargets()}
                        disabled={
                          runtime.loadingTargets || !runtime.selectedProfileKey
                        }
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        刷新标签页
                      </button>
                      <button
                        type="button"
                        className={compactActionButtonClass}
                        onClick={() => void runtime.openSession()}
                        disabled={
                          runtime.openingSession || !runtime.selectedProfileKey
                        }
                      >
                        {runtime.openingSession ? "打开中..." : "重新附着"}
                      </button>
                      <button
                        type="button"
                        className={compactActionButtonClass}
                        onClick={() => void handleOpenSystemBrowser()}
                        disabled={!currentUrl}
                      >
                        <Globe className="h-3.5 w-3.5" />在 Chrome 中继续
                      </button>
                    </div>

                    {showSiteAdapterPanel ? (
                      <BrowserSiteAdapterPanel
                        selectedProfileKey={runtime.selectedProfileKey}
                        onMessage={onMessage}
                        variant="debug"
                      />
                    ) : null}

                    <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-md border p-3 text-xs">
                        <div className="mb-2 text-sm font-medium">会话信息</div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <span className="text-muted-foreground">
                              Session：
                            </span>
                            <span className="break-all">
                              {runtime.sessionState?.session_id || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Target：
                            </span>
                            <span className="break-all">
                              {runtime.sessionState?.target_id || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              状态：
                            </span>
                            <span>
                              {runtime.sessionState?.lifecycle_state || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              控制模式：
                            </span>
                            <span>
                              {runtime.sessionState?.control_mode || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">WS：</span>
                            <span className="break-all">
                              {runtime.sessionState?.ws_debugger_url || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              最后帧：
                            </span>
                            <span>
                              {runtime.sessionState?.last_frame_at || "-"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                        {renderAuditPanel("max-h-[180px]")}

                        <div className="rounded-md border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-sm font-medium">Console</div>
                            <div className="text-[11px] text-muted-foreground">
                              {runtime.consoleEvents.length} 条
                            </div>
                          </div>
                          <div className="max-h-[180px] space-y-2 overflow-auto text-xs">
                            {runtime.consoleEvents.length === 0 ? (
                              <div className="text-muted-foreground">
                                暂无 Console 事件
                              </div>
                            ) : (
                              runtime.consoleEvents.map((event) => (
                                <div
                                  key={event.sequence}
                                  className="rounded border p-2"
                                >
                                  <div className="font-medium text-foreground/90">
                                    [
                                    {event.type === "console_message"
                                      ? event.level
                                      : event.type}
                                    ]
                                  </div>
                                  <div className="text-muted-foreground">
                                    {formatEventSubtitle(event)}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-md border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-sm font-medium">Network</div>
                            <div className="text-[11px] text-muted-foreground">
                              {runtime.networkEvents.length} 条
                            </div>
                          </div>
                          <div className="max-h-[180px] space-y-2 overflow-auto text-xs">
                            {runtime.networkEvents.length === 0 ? (
                              <div className="text-muted-foreground">
                                暂无 Network 事件
                              </div>
                            ) : (
                              runtime.networkEvents.map((event) => (
                                <div
                                  key={event.sequence}
                                  className="rounded border p-2"
                                >
                                  <div className="font-medium text-foreground/90">
                                    {event.type}
                                  </div>
                                  <div className="break-all text-muted-foreground">
                                    {formatEventSubtitle(event)}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">浏览器实时会话</h3>
          <p className="text-xs text-muted-foreground">
            在通用对话里直接查看浏览器现场。需要时可人工接管，并在完成后交回给
            Agent。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showStandaloneWindowButton ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
              onClick={() => void handleOpenStandaloneWindow()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              独立窗口
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            <Bug className="h-3.5 w-3.5" />
            {showAdvanced ? "收起高级调试" : "高级调试"}
          </button>
        </div>
      </div>

      {sessions.length === 0 && !hasAttachIntent ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          还没有运行中的独立 Chrome Profile。请先从通用对话启动浏览器协助。
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-muted/15 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">当前页面</div>
                <div className="truncate text-sm font-medium">
                  {currentTitle}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {currentUrl || "尚未获取页面 URL"}
                </div>
              </div>
              <div
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusInfo.toneClass}`}
              >
                {statusInfo.label}
              </div>
            </div>

            <div className="mb-3 rounded-lg border bg-background/70 px-3 py-2">
              <div className="text-xs text-foreground">
                {statusInfo.description}
              </div>
              {runtime.sessionState?.last_error ? (
                <div className="mt-1 text-[11px] text-destructive">
                  最近错误: {runtime.sessionState.last_error}
                </div>
              ) : null}
            </div>

            <div
              ref={liveViewRef}
              className={`relative h-[260px] w-full overflow-hidden rounded-lg border bg-black/95 sm:h-[320px] lg:h-[420px] ${
                runtime.canDirectControl ? "cursor-crosshair" : "cursor-default"
              }`}
              onClick={(event) => void handleLiveViewClick(event)}
              onWheel={(event) => void handleLiveViewWheel(event)}
            >
              {runtime.latestFrame ? (
                <img
                  src={`data:image/jpeg;base64,${runtime.latestFrame}`}
                  alt="browser-live-view"
                  className="absolute inset-0 h-full w-full select-none object-contain"
                  draggable={false}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {effectiveLiveViewPlaceholder}
                </div>
              )}

              <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
                {runtime.sessionState?.transport_kind ||
                  (showAttachPresentation
                    ? "existing_session"
                    : "cdp_frames")}
              </div>

              <div className="absolute bottom-3 left-3 right-3 rounded-md bg-black/60 px-3 py-2 text-[11px] text-white/90">
                {showAttachPresentation
                  ? attachPresentation.liveViewHint
                  : runtime.canDirectControl
                    ? "当前支持点击画面、滚轮滚动，并把文本发送到当前焦点元素。"
                    : "点击“接管浏览器”后，可直接在这里进行最小人工操作。"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {showAttachPresentation ? (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() => void loadAttachContext()}
                  disabled={attachContextLoading}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      attachContextLoading ? "animate-spin" : ""
                    }`}
                  />
                  {attachPresentation.contextActionLabel}
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() => void loadAttachPage()}
                  disabled={
                    attachPageLoading || !attachPresentation.observerConnected
                  }
                >
                  {attachPresentation.pageActionLabel}
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() => void loadAttachTabs()}
                  disabled={
                    attachTabsLoading || !attachPresentation.observerConnected
                  }
                >
                  {attachPresentation.tabsActionLabel}
                </button>
              </>
            ) : !runtime.sessionState ? (
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                onClick={() => void runtime.openSession()}
                disabled={runtime.openingSession || !runtime.selectedProfileKey}
              >
                {runtime.openingSession ? "连接中..." : "连接浏览器"}
              </button>
            ) : null}

            {runtime.sessionState ? (
              <>
                {runtime.isHumanControlling ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300/70 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200"
                      onClick={() => void runtime.resumeSession()}
                      disabled={runtime.controlBusy}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {runtime.controlBusy ? "处理中..." : "我已完成，继续执行"}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                      onClick={() => void runtime.releaseSession()}
                      disabled={runtime.controlBusy}
                    >
                      <Pause className="h-3.5 w-3.5" />
                      结束接管
                    </button>
                  </>
                ) : runtime.isWaitingForHuman ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
                      onClick={() => void runtime.takeOverSession()}
                      disabled={runtime.controlBusy}
                    >
                      <Hand className="h-3.5 w-3.5" />
                      开始人工处理
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                      onClick={() =>
                        void runtime.resumeSession("无需人工处理，继续执行")
                      }
                      disabled={runtime.controlBusy}
                    >
                      <Play className="h-3.5 w-3.5" />
                      直接继续执行
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
                    onClick={() => void runtime.takeOverSession()}
                    disabled={runtime.controlBusy || runtime.isAgentResuming}
                  >
                    <Hand className="h-3.5 w-3.5" />
                    {runtime.isAgentResuming ? "恢复中..." : "接管浏览器"}
                  </button>
                )}

                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() =>
                    void (runtime.streaming
                      ? runtime.stopStream()
                      : runtime.startStream("both"))
                  }
                  disabled={!runtime.sessionState}
                >
                  {runtime.streaming ? "停止实时画面" : "恢复实时画面"}
                </button>

                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() => void runtime.refreshSessionState()}
                  disabled={runtime.refreshingState}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      runtime.refreshingState ? "animate-spin" : ""
                    }`}
                  />
                  {runtime.refreshingState ? "刷新中..." : "刷新状态"}
                </button>

                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                  onClick={() => void runtime.closeSession()}
                >
                  关闭会话
                </button>
              </>
            ) : null}
          </div>

          <div className="rounded-lg border bg-background/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium">最小人工控制</div>
                <div className="text-[11px] text-muted-foreground">
                  适合验证码、短信码、多因素认证和临时异常流程。
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {runtime.canDirectControl ? "已启用" : "未启用"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                className="w-full min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[220px]"
                placeholder="把文本发送到当前焦点元素"
                value={manualInput}
                disabled={!runtime.canDirectControl || runtime.controlBusy}
                onChange={(event) => setManualInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSendManualInput();
                  }
                }}
              />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!runtime.canDirectControl || runtime.controlBusy}
                onClick={() => void handleSendManualInput()}
              >
                <Send className="h-3.5 w-3.5" />
                发送文本
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!runtime.canDirectControl || runtime.controlBusy}
                onClick={() => void runtime.scrollPage("up")}
              >
                上滚
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!runtime.canDirectControl || runtime.controlBusy}
                onClick={() => void runtime.scrollPage("down")}
              >
                下滚
              </button>
            </div>
          </div>

          {showAdvanced ? (
            showAttachPresentation ? (
              <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                <div>{renderAttachFallbackPanel("max-h-[220px]")}</div>
                <div>{renderAuditPanel("max-h-[220px]")}</div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">Profile 会话</span>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={runtime.selectedProfileKey}
                      onChange={(event) =>
                        runtime.setSelectedProfileKey(event.target.value)
                      }
                    >
                      {sessions.map((session) => (
                        <option
                          key={session.profile_key}
                          value={session.profile_key}
                        >
                          {session.profile_key} · PID {session.pid}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">CDP 标签页</span>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={runtime.selectedTargetId}
                      onChange={(event) =>
                        runtime.setSelectedTargetId(event.target.value)
                      }
                    >
                      {runtime.targets.length === 0 ? (
                        <option value="">未发现标签页</option>
                      ) : (
                        runtime.targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.title || target.url || target.id}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    onClick={() => void runtime.refreshTargets()}
                    disabled={
                      runtime.loadingTargets || !runtime.selectedProfileKey
                    }
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    刷新标签页
                  </button>
                  <button
                    type="button"
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    onClick={() => void runtime.openSession()}
                    disabled={
                      runtime.openingSession || !runtime.selectedProfileKey
                    }
                  >
                    {runtime.openingSession ? "打开中..." : "重新附着会话"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    onClick={() => void handleOpenSystemBrowser()}
                    disabled={!currentUrl}
                  >
                    <Globe className="h-3.5 w-3.5" />在 Chrome 中继续
                  </button>
                </div>

                {showSiteAdapterPanel ? (
                  <BrowserSiteAdapterPanel
                    selectedProfileKey={runtime.selectedProfileKey}
                    onMessage={onMessage}
                    variant="debug"
                  />
                ) : null}

                <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-3">
                    <div className="rounded-md border p-3 text-xs">
                      <div className="mb-2 text-sm font-medium">会话信息</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">
                            Session：
                          </span>
                          <span className="break-all">
                            {runtime.sessionState?.session_id || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Target：
                          </span>
                          <span className="break-all">
                            {runtime.sessionState?.target_id || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">状态：</span>
                          <span>
                            {runtime.sessionState?.lifecycle_state || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            控制模式：
                          </span>
                          <span>
                            {runtime.sessionState?.control_mode || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">WS：</span>
                          <span className="break-all">
                            {runtime.sessionState?.ws_debugger_url || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            最后帧：
                          </span>
                          <span>
                            {runtime.sessionState?.last_frame_at || "-"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {renderAuditPanel("max-h-[220px]")}

                    <div className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-medium">Console</div>
                        <div className="text-[11px] text-muted-foreground">
                          {runtime.consoleEvents.length} 条
                        </div>
                      </div>
                      <div className="max-h-[220px] space-y-2 overflow-auto text-xs">
                        {runtime.consoleEvents.length === 0 ? (
                          <div className="text-muted-foreground">
                            暂无 Console 事件
                          </div>
                        ) : (
                          runtime.consoleEvents.map((event) => (
                            <div
                              key={event.sequence}
                              className="rounded border p-2"
                            >
                              <div className="font-medium text-foreground/90">
                                [
                                {event.type === "console_message"
                                  ? event.level
                                  : event.type}
                                ]
                              </div>
                              <div className="text-muted-foreground">
                                {formatEventSubtitle(event)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-medium">Network</div>
                        <div className="text-[11px] text-muted-foreground">
                          {runtime.networkEvents.length} 条
                        </div>
                      </div>
                      <div className="max-h-[220px] space-y-2 overflow-auto text-xs">
                        {runtime.networkEvents.length === 0 ? (
                          <div className="text-muted-foreground">
                            暂无 Network 事件
                          </div>
                        ) : (
                          runtime.networkEvents.map((event) => (
                            <div
                              key={event.sequence}
                              className="rounded border p-2"
                            >
                              <div className="font-medium text-foreground/90">
                                {event.type}
                              </div>
                              <div className="break-all text-muted-foreground">
                                {formatEventSubtitle(event)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
