import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isBrowserTabHostAvailable,
  listenBrowserTabCommand,
  listenBrowserTabDownload,
  listenBrowserTabLoadFailed,
  listenBrowserTabPermissionRequest,
  navigateBrowserTab,
  goBackBrowserTab,
  goForwardBrowserTab,
  printBrowserTab,
  reloadBrowserTab,
  setBrowserTabZoom,
  setBrowserTabDevice,
  selectBrowserTab,
  setBrowserTabBounds,
  type BrowserTabDownloadEvent,
  type BrowserTabLoadFailedEvent,
  type BrowserTabPermissionRequestEvent,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import type { BrowserWorkspaceOwner } from "@/lib/api/browserWorkspace";
import type { EmbeddedBrowserBounds } from "@/lib/api/embeddedBrowser";
import {
  DEFAULT_BROWSER_URL,
  BROWSER_ZOOM_STEP,
  clampBrowserZoom,
  browserBoundsEqual,
  normalizeBrowserAddress,
  resolveElementBounds,
} from "./browserWorkspaceModel";
import {
  BrowserWorkspaceDownloadShelf,
  BrowserWorkspaceErrorBanner,
  BrowserWorkspaceHostUnavailable,
  BrowserWorkspaceLoading,
  BrowserWorkspacePermissionBanner,
  type BrowserWorkspaceError,
} from "./BrowserWorkspaceStatus";
import {
  BrowserNavigationBar,
  browserIconButton,
} from "./BrowserNavigationBar";
import { SquareMousePointer } from "lucide-react";
import { useBrowserAnnotations } from "./useBrowserAnnotations";
import { BrowserAnnotationToolbar } from "./BrowserAnnotationToolbar";
import { BrowserFindBar } from "./BrowserFindBar";
import { useBrowserWorkspaceHydration } from "./useBrowserWorkspaceHydration";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";
import { BrowserOptionsMenu } from "./BrowserOptionsMenu";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";

interface BrowserWorkspaceProps {
  active?: boolean;
  tabId?: string;
  ensureOwner?: () => Promise<BrowserWorkspaceOwner | null>;
  initialUrl?: string | null;
  launchTabId?: string | null;
  launchRequestId?: string | null;
  onLaunchApplied?: (requestId: string) => void;
  runtimeSessionId?: string | null;
  threadId: string;
  onNavigate?: (url: string, title?: string | null) => void;
  onSelectedStateChange?: (state: BrowserTabState | null) => void;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const BrowserWorkspace = memo(function BrowserWorkspace({
  active = true,
  tabId,
  ensureOwner,
  initialUrl,
  launchTabId,
  launchRequestId,
  onLaunchApplied,
  runtimeSessionId,
  threadId,
  onNavigate,
  onSelectedStateChange,
}: BrowserWorkspaceProps) {
  const { t } = useTranslation("agent");
  const translate = useCallback<Translate>(
    (key, options) => String(t(key as never, options as never)),
    [t],
  );
  const hostAvailable = isBrowserTabHostAvailable();
  const resolvedInitialUrl = useMemo(
    () => normalizeBrowserAddress(initialUrl || DEFAULT_BROWSER_URL),
    [initialUrl],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<EmbeddedBrowserBounds | null>(null);
  const selectedRef = useRef<BrowserTabState | null>(null);
  const activeRef = useRef(active);
  const lastNavigationRef = useRef("");
  const appliedLaunchRef = useRef("");
  const [findVisible, setFindVisible] = useState(false);
  const [addressFocusRequest, setAddressFocusRequest] = useState(0);
  const [download, setDownload] = useState<BrowserTabDownloadEvent | null>(
    null,
  );
  const [permission, setPermission] =
    useState<BrowserTabPermissionRequestEvent | null>(null);
  const [error, setError] = useState<BrowserWorkspaceError | null>(null);
  activeRef.current = active;
  const reportHostError = useCallback(
    (reason: unknown) => {
      setError({
        body: reason instanceof Error ? reason.message : String(reason),
        source: "host",
        title: translate("agentChat.browserWorkspace.loadFailedTitle"),
      });
    },
    [translate],
  );
  const { owner, identity, tabs, acceptState, isCurrent } =
    useBrowserWorkspaceHydration({
      ensureOwner,
      hostAvailable,
      runtimeSessionId,
      threadId,
      initialUrl: resolvedInitialUrl,
      viewportRef,
      lastBoundsRef,
      onError: reportHostError,
    });

  const selected =
    tabs.find((tab) => (tabId ? tab.tabId === tabId : tab.selected)) ?? null;
  selectedRef.current = selected;
  const annotations = useBrowserAnnotations({
    selected,
    active,
    onError: reportHostError,
  });
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  useEffect(() => setFindVisible(false), [selected?.tabId, selected?.url]);

  const acceptsSelectedHostEvent = useCallback(
    (
      event:
        | BrowserTabDownloadEvent
        | BrowserTabLoadFailedEvent
        | BrowserTabPermissionRequestEvent,
    ) => {
      const tab = selectedRef.current;
      return Boolean(
        identity &&
        owner &&
        tab &&
        event.browserSessionId === identity.browserSessionId &&
        event.browserSessionId === tab.browserSessionId &&
        event.threadId === owner.threadId &&
        event.threadId === tab.threadId &&
        event.tabId === tab.tabId &&
        event.viewId === tab.viewId &&
        event.webContentsId === tab.webContentsId &&
        event.ownerWebContentsId === tab.ownerWebContentsId &&
        event.windowId === tab.windowId,
      );
    },
    [identity, owner],
  );

  const run = useCallback(
    async (operation: () => Promise<BrowserTabState>) => {
      if (!isCurrent()) return;
      try {
        const state = await operation();
        if (!isCurrent()) return;
        acceptState(state);
        setError((current) => (current?.source === "host" ? null : current));
      } catch (reason) {
        if (isCurrent()) reportHostError(reason);
      }
    },
    [acceptState, isCurrent, reportHostError],
  );

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listenBrowserTabCommand((event) => {
      const tab = selectedRef.current;
      if (!activeRef.current || !tab || !matchesBrowserTabEvent(tab, event))
        return;
      const command = event.command;
      if (command === "focus-address") {
        void (async () => {
          const annotation = annotationsRef.current;
          if (annotation.selecting) await annotation.exit();
          if (
            activeRef.current &&
            matchesBrowserTabEvent(selectedRef.current, tab) &&
            selectedRef.current?.pageRevision === tab.pageRevision
          )
            setAddressFocusRequest((value) => value + 1);
        })().catch(reportHostError);
      } else if (command === "find") setFindVisible(true);
      else if (command === "reload")
        void run(() => reloadBrowserTab(tab.tabId));
      else if (command === "go-back" && tab.canGoBack)
        void run(() => goBackBrowserTab(tab.tabId));
      else if (command === "go-forward" && tab.canGoForward)
        void run(() => goForwardBrowserTab(tab.tabId));
      else if (
        command === "zoom-in" ||
        command === "zoom-out" ||
        command === "zoom-reset"
      ) {
        const zoom =
          command === "zoom-reset"
            ? 1
            : clampBrowserZoom(
                (tab.zoomFactor ?? 1) +
                  (command === "zoom-in"
                    ? BROWSER_ZOOM_STEP
                    : -BROWSER_ZOOM_STEP),
              );
        void run(() => setBrowserTabZoom(tab.tabId, zoom));
      } else if (command === "print") {
        void run(async () => {
          const result = await printBrowserTab(tab.tabId);
          if (
            !result.printed &&
            result.failureReason &&
            !/cancel/i.test(result.failureReason)
          )
            throw new Error(result.failureReason);
          return result.state;
        });
      }
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(reportHostError);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [reportHostError, run]);

  useEffect(() => {
    const target = launchTabId
      ? tabs.find((tab) => tab.tabId === launchTabId)
      : selected;
    if (
      !active ||
      !launchRequestId ||
      !owner ||
      !target ||
      (tabId && target.tabId !== tabId) ||
      !isCurrent()
    )
      return;
    const key = `${owner.runtimeSessionId}\u0000${owner.threadId}\u0000${launchRequestId}`;
    if (appliedLaunchRef.current === key) return;
    appliedLaunchRef.current = key;
    const current = () => isCurrent() && appliedLaunchRef.current === key;
    void (async () => {
      let state = target;
      if (!state.selected) {
        const element = viewportRef.current;
        if (!element) throw new Error("Browser viewport is unavailable");
        state = await selectBrowserTab({
          tabId: target.tabId,
          bounds: resolveElementBounds(element),
        });
        if (!current()) return;
      }
      if (initialUrl && state.url !== resolvedInitialUrl) {
        state = await navigateBrowserTab(state.tabId, resolvedInitialUrl);
        if (!current()) return;
      }
      if (
        state.tabId !== target.tabId ||
        state.browserSessionId !== target.browserSessionId ||
        state.threadId !== owner.threadId
      )
        throw new Error(
          "Browser launch response does not belong to the requested tab",
        );
      acceptState(state);
      onLaunchApplied?.(launchRequestId);
      setError((previous) => (previous?.source === "host" ? null : previous));
    })().catch((reason: unknown) => {
      if (isCurrent() && appliedLaunchRef.current === key)
        reportHostError(reason);
    });
  }, [
    active,
    launchRequestId,
    launchTabId,
    tabId,
    initialUrl,
    owner,
    selected,
    tabs,
    resolvedInitialUrl,
    isCurrent,
    acceptState,
    reportHostError,
    onLaunchApplied,
  ]);

  const syncBounds = useCallback(
    async (force = false) => {
      const element = viewportRef.current;
      const tab = selectedRef.current;
      if (!isCurrent() || !hostAvailable || !element || !tab) {
        return;
      }
      const bounds = resolveElementBounds(element);
      if (!force && browserBoundsEqual(lastBoundsRef.current, bounds)) {
        return;
      }
      lastBoundsRef.current = bounds;
      await run(() =>
        setBrowserTabBounds({
          tabId: tab.tabId,
          bounds,
          visible: activeRef.current && bounds.width > 0 && bounds.height > 0,
        }),
      );
    },
    [hostAvailable, isCurrent, run],
  );

  useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const register = async (promise: Promise<() => void>) => {
      const stop = await promise;
      if (disposed) {
        stop();
      } else {
        cleanup.push(stop);
      }
    };
    void register(
      listenBrowserTabLoadFailed((event) => {
        if (acceptsSelectedHostEvent(event)) {
          setError(
            resolveLoadError(
              event.failureCategory,
              event.errorDescription,
              translate,
            ),
          );
        }
      }),
    );
    void register(
      listenBrowserTabDownload((event) => {
        if (acceptsSelectedHostEvent(event)) {
          setDownload(event);
        }
      }),
    );
    void register(
      listenBrowserTabPermissionRequest((event) => {
        if (acceptsSelectedHostEvent(event)) {
          setPermission(event);
        }
      }),
    );
    return () => {
      disposed = true;
      cleanup.forEach((stop) => stop());
    };
  }, [acceptsSelectedHostEvent, identity, owner?.threadId, translate]);

  useEffect(() => {
    setPermission((current) =>
      current?.tabId === selected?.tabId ? current : null,
    );
    setDownload((current) =>
      current?.tabId === selected?.tabId ? current : null,
    );
    setError((current) => (current?.source === "load" ? null : current));
  }, [selected?.tabId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncBounds]);

  useEffect(() => {
    onSelectedStateChange?.(selected);
    const navigationKey = selected
      ? `${selected.tabId}\u0000${selected.url}\u0000${selected.title}`
      : "";
    if (selected && navigationKey !== lastNavigationRef.current) {
      lastNavigationRef.current = navigationKey;
      onNavigate?.(selected.url, selected.title || null);
    }
  }, [onNavigate, onSelectedStateChange, selected]);

  useEffect(() => {
    if (selected?.tabId) {
      if (active && !selected.selected) {
        const element = viewportRef.current;
        if (element)
          void run(() =>
            selectBrowserTab({
              tabId: selected.tabId,
              bounds: resolveElementBounds(element),
            }),
          );
      } else void syncBounds(true);
    }
  }, [active, selected?.tabId, selected?.selected, syncBounds, run]);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--lime-surface)]"
      data-testid="browser-workspace"
      data-browser-active-turn-id={selected?.activeTurnId ?? ""}
      data-browser-control-owner={selected?.controlOwner ?? ""}
      data-browser-loading={selected?.isLoading ? "true" : "false"}
      data-browser-page-revision={selected?.pageRevision ?? ""}
      data-browser-session-id={identity?.browserSessionId ?? ""}
      data-browser-tab-id={selected?.tabId ?? ""}
      data-browser-thread-id={owner?.threadId ?? ""}
      data-browser-view-id={selected?.viewId ?? ""}
      data-browser-web-contents-id={selected?.webContentsId ?? ""}
      data-browser-url={selected?.url ?? ""}
      data-browser-zoom-factor={selected?.zoomFactor ?? 1}
    >
      {annotations.selecting ? (
        <BrowserAnnotationToolbar
          selected={selected}
          active={active}
          suspended={annotations.suspended}
          addModifierPressed={annotations.addModifierPressed}
          onExit={annotations.exit}
          onAddToComposer={annotations.addToComposer}
          onError={reportHostError}
        />
      ) : (
        <BrowserNavigationBar
          selected={selected}
          translate={translate}
          run={run}
          annotationAction={
            <button
              type="button"
              className={browserIconButton}
              disabled={!active || !annotations.available}
              aria-label={translate("browserAnnotation.select")}
              title={translate("browserAnnotation.select")}
              aria-pressed={annotations.selecting}
              data-testid="browser-annotation-select"
              onClick={() => void annotations.begin().catch(reportHostError)}
            >
              <SquareMousePointer className="h-4 w-4" aria-hidden="true" />
            </button>
          }
          actions={
            <BrowserOptionsMenu
              selected={selected}
              owner={owner}
              active={active}
              run={run}
              onFind={() => setFindVisible(true)}
              onError={reportHostError}
              onDeviceToggle={() => {
                if (!selected) return;
                void run(() =>
                  setBrowserTabDevice(
                    selected.tabId,
                    selected.device
                      ? null
                      : {
                          width: 390,
                          height: 844,
                          deviceScaleFactor: 3,
                          scale: 0.5,
                          mobile: true,
                        },
                  ),
                );
              }}
            />
          }
          addressFocusRequest={addressFocusRequest}
        />
      )}
      {selected?.device ? (
        <BrowserDeviceToolbar
          key={selected.tabId}
          selected={selected}
          run={run}
        />
      ) : null}
      {findVisible && selected ? (
        <BrowserFindBar
          key={selected.tabId}
          selected={selected}
          translate={translate}
          run={run}
          onClose={() => setFindVisible(false)}
        />
      ) : null}

      {error ? <BrowserWorkspaceErrorBanner error={error} /> : null}
      {permission ? (
        <BrowserWorkspacePermissionBanner
          permission={permission}
          t={translate}
        />
      ) : null}
      {download ? (
        <BrowserWorkspaceDownloadShelf download={download} t={translate} />
      ) : null}

      <div
        className="relative min-h-0 flex-1 bg-white"
        data-browser-viewport-state={selected ? "mounted" : "empty"}
        data-testid="browser-workspace-viewport"
        ref={viewportRef}
      >
        {!hostAvailable ? (
          <BrowserWorkspaceHostUnavailable t={translate} />
        ) : !selected && !error ? (
          <BrowserWorkspaceLoading t={translate} />
        ) : null}
      </div>
    </section>
  );
});

function resolveLoadError(
  category: string,
  message: string,
  t: Translate,
): BrowserWorkspaceError {
  const suffix =
    category === "dns"
      ? "Dns"
      : category === "tls"
        ? "Tls"
        : category === "blocked"
          ? "Blocked"
          : category === "aborted"
            ? "Aborted"
            : "";
  return {
    title: t(`agentChat.browserWorkspace.loadFailed${suffix}Title`),
    body: t(`agentChat.browserWorkspace.loadFailed${suffix}Body`, { message }),
    source: "load",
  };
}
