import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { LayoutMode } from "@/components/content-creator/types";
import { browserExecuteAction, launchBrowserSession } from "@/lib/webview-api";
import type { Artifact } from "@/lib/artifact/types";
import type {
  BrowserAssistSessionState,
  Message,
} from "../types";
import {
  areBrowserAssistSessionStatesEqual,
  clearBrowserAssistSessionState,
  createBrowserAssistSessionState,
  extractBrowserAssistSessionFromArtifact,
  findLatestBrowserAssistSessionInMessages,
  loadBrowserAssistSessionState,
  mergeBrowserAssistSessionStates,
  resolveBrowserAssistSessionScopeKey,
  saveBrowserAssistSessionState,
} from "../utils/browserAssistSession";
import {
  extractExplicitUrlFromText,
  resolveBrowserAssistLaunchUrl,
} from "../utils/browserAssistIntent";
import {
  GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
  asRecord,
  buildBrowserAssistArtifact,
  buildFailedBrowserAssistArtifact,
  buildPendingBrowserAssistArtifact,
  readFirstString,
  resolveBrowserAssistArtifactScopeKey,
} from "./browserAssistArtifact";

function hasActiveBrowserAssistSession(
  sessionState: BrowserAssistSessionState | null,
): boolean {
  if (!sessionState) {
    return false;
  }

  if (!sessionState.sessionId && !sessionState.profileKey) {
    return false;
  }

  const lifecycleState = sessionState.lifecycleState?.trim().toLowerCase();
  return !["failed", "closed", "terminated"].includes(lifecycleState || "");
}

type EnsureBrowserAssistCanvasHandler = (
  sourceText: string,
  options?: {
    silent?: boolean;
    navigationMode?: "none" | "explicit-url" | "best-effort";
  },
) => Promise<boolean>;

interface UseWorkspaceBrowserAssistRuntimeParams {
  activeTheme: string;
  projectId?: string | null;
  sessionId?: string | null;
  input: string;
  initialUserPrompt?: string;
  openBrowserAssistOnMount: boolean;
  artifacts: Artifact[];
  messages: Message[];
  currentCanvasArtifact: Artifact | null;
  layoutMode: LayoutMode;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setSelectedArtifactId: (artifactId: string | null) => void;
  upsertGeneralArtifact: (artifact: Artifact) => void;
  generalBrowserAssistProfileKey: string;
}

interface WorkspaceBrowserAssistRuntimeResult {
  browserAssistLaunching: boolean;
  isBrowserAssistReady: boolean;
  isBrowserAssistCanvasVisible: boolean;
  currentBrowserAssistScopeKey: string | null;
  ensureBrowserAssistCanvas: EnsureBrowserAssistCanvasHandler;
  handleOpenBrowserAssistInCanvas: () => Promise<void>;
  suppressBrowserAssistCanvasAutoOpen: () => void;
  suppressGeneralCanvasArtifactAutoOpen: () => void;
}

export function useWorkspaceBrowserAssistRuntime({
  activeTheme,
  projectId,
  sessionId,
  input,
  initialUserPrompt,
  openBrowserAssistOnMount,
  artifacts,
  messages,
  currentCanvasArtifact,
  layoutMode,
  setLayoutMode,
  setSelectedArtifactId,
  upsertGeneralArtifact,
  generalBrowserAssistProfileKey,
}: UseWorkspaceBrowserAssistRuntimeParams): WorkspaceBrowserAssistRuntimeResult {
  const [browserAssistLaunching, setBrowserAssistLaunching] = useState(false);
  const [browserAssistSessionState, setBrowserAssistSessionState] =
    useState<BrowserAssistSessionState | null>(null);
  const openBrowserAssistOnMountHandledRef = useRef(false);
  const autoOpenedBrowserAssistSessionIdRef = useRef<string>("");
  const autoLaunchingBrowserAssistKeyRef = useRef<string>("");
  const browserAssistLaunchRequestIdRef = useRef(0);
  const browserAssistAutoOpenDismissedScopeRef = useRef<string | null>(null);
  const browserAssistScopeTrackerRef = useRef<string | null>(null);
  const dismissedGeneralCanvasAutoOpenFingerprintRef = useRef<string | null>(
    null,
  );
  const previousGeneralCanvasAutoOpenSessionIdRef = useRef<string | null>(
    sessionId ?? null,
  );

  const currentBrowserAssistScopeKey = useMemo(
    () =>
      activeTheme === "general"
        ? resolveBrowserAssistSessionScopeKey(projectId, sessionId)
        : null,
    [activeTheme, projectId, sessionId],
  );

  const browserAssistArtifact = useMemo(
    () =>
      artifacts.find(
        (artifact) =>
          artifact.id === GENERAL_BROWSER_ASSIST_ARTIFACT_ID &&
          artifact.type === "browser_assist" &&
          resolveBrowserAssistArtifactScopeKey(artifact) ===
            currentBrowserAssistScopeKey,
      ) || null,
    [artifacts, currentBrowserAssistScopeKey],
  );

  const latestBrowserAssistSessionFromMessages = useMemo(
    () => findLatestBrowserAssistSessionInMessages(messages),
    [messages],
  );

  const browserAssistSessionFromArtifact = useMemo(
    () => extractBrowserAssistSessionFromArtifact(browserAssistArtifact),
    [browserAssistArtifact],
  );

  const browserAssistStorageKey = useMemo(
    () =>
      activeTheme === "general"
        ? `${projectId || "global"}:${sessionId || "active"}`
        : null,
    [activeTheme, projectId, sessionId],
  );

  const latestGeneralCanvasAutoOpenFingerprint = useMemo(() => {
    if (activeTheme !== "general") {
      return null;
    }

    const latestArtifact = [...artifacts]
      .reverse()
      .find((artifact) => artifact.type !== "browser_assist");
    if (!latestArtifact) {
      return null;
    }

    return `${latestArtifact.id}:${latestArtifact.updatedAt}:${latestArtifact.status}`;
  }, [activeTheme, artifacts]);

  const isBrowserAssistReady = useMemo(
    () => hasActiveBrowserAssistSession(browserAssistSessionState),
    [browserAssistSessionState],
  );

  const isBrowserAssistCanvasVisible =
    activeTheme === "general" &&
    layoutMode !== "chat" &&
    currentCanvasArtifact?.type === "browser_assist";

  const openBrowserAssistCanvas = useCallback(
    (artifactId = GENERAL_BROWSER_ASSIST_ARTIFACT_ID) => {
      browserAssistAutoOpenDismissedScopeRef.current = null;
      setSelectedArtifactId(artifactId);
      setLayoutMode("chat-canvas");
    },
    [setLayoutMode, setSelectedArtifactId],
  );

  const autoOpenBrowserAssistCanvas = useCallback(
    (artifactId = GENERAL_BROWSER_ASSIST_ARTIFACT_ID) => {
      if (
        activeTheme === "general" &&
        browserAssistAutoOpenDismissedScopeRef.current
      ) {
        return false;
      }

      setSelectedArtifactId(artifactId);
      setLayoutMode("chat-canvas");
      return true;
    },
    [activeTheme, setLayoutMode, setSelectedArtifactId],
  );

  const suppressBrowserAssistCanvasAutoOpen = useCallback(() => {
    if (activeTheme !== "general") {
      return;
    }

    browserAssistAutoOpenDismissedScopeRef.current = "__dismissed__";
  }, [activeTheme]);

  const suppressGeneralCanvasArtifactAutoOpen = useCallback(() => {
    if (activeTheme !== "general" || !latestGeneralCanvasAutoOpenFingerprint) {
      return;
    }

    dismissedGeneralCanvasAutoOpenFingerprintRef.current =
      latestGeneralCanvasAutoOpenFingerprint;
  }, [activeTheme, latestGeneralCanvasAutoOpenFingerprint]);

  useEffect(() => {
    const normalizedSessionId = sessionId ?? null;
    if (
      previousGeneralCanvasAutoOpenSessionIdRef.current === normalizedSessionId
    ) {
      return;
    }

    previousGeneralCanvasAutoOpenSessionIdRef.current = normalizedSessionId;
    dismissedGeneralCanvasAutoOpenFingerprintRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (activeTheme !== "general") {
      browserAssistScopeTrackerRef.current = null;
      browserAssistAutoOpenDismissedScopeRef.current = null;
      return;
    }

    if (!currentBrowserAssistScopeKey) {
      return;
    }

    if (
      browserAssistScopeTrackerRef.current &&
      browserAssistScopeTrackerRef.current !== currentBrowserAssistScopeKey
    ) {
      browserAssistAutoOpenDismissedScopeRef.current = null;
    }

    browserAssistScopeTrackerRef.current = currentBrowserAssistScopeKey;
  }, [activeTheme, currentBrowserAssistScopeKey]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }
    if (artifacts.length === 0) {
      return;
    }

    const hasNonBrowserAssistArtifact = artifacts.some(
      (artifact) => artifact.type !== "browser_assist",
    );
    const hasBoundBrowserAssistSession = Boolean(
      browserAssistSessionState?.sessionId ||
        browserAssistSessionState?.profileKey,
    );
    if (!hasNonBrowserAssistArtifact && !hasBoundBrowserAssistSession) {
      return;
    }

    if (
      !hasNonBrowserAssistArtifact &&
      browserAssistAutoOpenDismissedScopeRef.current
    ) {
      return;
    }

    if (
      hasNonBrowserAssistArtifact &&
      latestGeneralCanvasAutoOpenFingerprint &&
      dismissedGeneralCanvasAutoOpenFingerprintRef.current ===
        latestGeneralCanvasAutoOpenFingerprint
    ) {
      return;
    }

    setLayoutMode("chat-canvas");
  }, [
    activeTheme,
    artifacts,
    browserAssistSessionState?.profileKey,
    browserAssistSessionState?.sessionId,
    latestGeneralCanvasAutoOpenFingerprint,
    setLayoutMode,
  ]);

  const commitBrowserAssistSessionState = useCallback(
    (candidate: BrowserAssistSessionState | null) => {
      if (activeTheme !== "general" || !candidate) {
        return;
      }

      setBrowserAssistSessionState((current) => {
        const next = mergeBrowserAssistSessionStates(current, candidate);
        return areBrowserAssistSessionStatesEqual(current, next)
          ? current
          : next;
      });
    },
    [activeTheme],
  );

  useEffect(() => {
    if (activeTheme !== "general") {
      setBrowserAssistSessionState(null);
      return;
    }

    setBrowserAssistSessionState(
      loadBrowserAssistSessionState(projectId, sessionId),
    );
  }, [activeTheme, browserAssistStorageKey, projectId, sessionId]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    commitBrowserAssistSessionState(browserAssistSessionFromArtifact);
  }, [
    activeTheme,
    browserAssistSessionFromArtifact,
    commitBrowserAssistSessionState,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    commitBrowserAssistSessionState(latestBrowserAssistSessionFromMessages);
  }, [
    activeTheme,
    commitBrowserAssistSessionState,
    latestBrowserAssistSessionFromMessages,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    if (browserAssistSessionState) {
      saveBrowserAssistSessionState(
        projectId,
        sessionId,
        browserAssistSessionState,
      );
      return;
    }

    clearBrowserAssistSessionState(projectId, sessionId);
  }, [
    activeTheme,
    browserAssistSessionState,
    browserAssistStorageKey,
    projectId,
    sessionId,
  ]);

  const navigateBrowserAssistCanvasToUrl = useCallback(
    async (url: string, options?: { silent?: boolean }): Promise<boolean> => {
      if (activeTheme !== "general" || !url.trim()) {
        return false;
      }

      const artifactMeta = asRecord(browserAssistArtifact?.meta);
      const profileKey =
        browserAssistSessionState?.profileKey ||
        readFirstString(artifactMeta ? [artifactMeta] : [], [
          "profileKey",
          "profile_key",
        ]) ||
        generalBrowserAssistProfileKey;
      const currentUrl =
        browserAssistSessionState?.url ||
        readFirstString(artifactMeta ? [artifactMeta] : [], [
          "url",
          "launchUrl",
        ]) ||
        "";
      const fallbackTitle =
        browserAssistSessionState?.title ||
        browserAssistArtifact?.title?.trim() ||
        "浏览器协助";

      if (currentUrl === url) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        return true;
      }

      setBrowserAssistLaunching(true);

      try {
        const result = await browserExecuteAction({
          profile_key: profileKey,
          backend: "cdp_direct",
          action: "navigate",
          args: {
            action: "goto",
            url,
            wait_for_page_info: true,
          },
          timeout_ms: 20000,
        });

        if (!result.success) {
          throw new Error(result.error || "浏览器导航失败");
        }

        const resultData = asRecord(result.data);
        const pageInfo =
          asRecord(resultData?.page_info) || asRecord(resultData?.pageInfo);
        const nextUrl =
          readFirstString(
            [pageInfo, resultData],
            ["url", "target_url", "targetUrl"],
          ) || url;
        const nextTitle =
          readFirstString(
            [pageInfo, resultData],
            ["title", "target_title", "targetTitle"],
          ) || fallbackTitle;

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId:
              result.session_id ||
              browserAssistSessionState?.sessionId ||
              undefined,
            profileKey,
            url: nextUrl,
            title: nextTitle,
            targetId:
              result.target_id ||
              browserAssistSessionState?.targetId ||
              undefined,
            transportKind: browserAssistSessionState?.transportKind,
            lifecycleState: browserAssistSessionState?.lifecycleState || "live",
            controlMode: browserAssistSessionState?.controlMode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);

        if (!options?.silent) {
          toast.success(`已切换浏览器页面：${nextTitle}`);
        }
        return true;
      } catch (error) {
        if (!options?.silent) {
          toast.error(
            `切换浏览器页面失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return false;
      } finally {
        setBrowserAssistLaunching(false);
      }
    },
    [
      activeTheme,
      browserAssistArtifact,
      browserAssistSessionState,
      commitBrowserAssistSessionState,
      generalBrowserAssistProfileKey,
      openBrowserAssistCanvas,
    ],
  );

  const ensureBrowserAssistCanvas = useCallback<EnsureBrowserAssistCanvasHandler>(
    async (
      sourceText: string,
      options?: {
        silent?: boolean;
        navigationMode?: "none" | "explicit-url" | "best-effort";
      },
    ): Promise<boolean> => {
      if (activeTheme !== "general") {
        return false;
      }

      const navigationMode = options?.navigationMode || "best-effort";
      const targetUrl =
        navigationMode === "explicit-url"
          ? extractExplicitUrlFromText(sourceText)
          : navigationMode === "best-effort"
            ? resolveBrowserAssistLaunchUrl(sourceText)
            : null;
      const artifactMeta = asRecord(browserAssistArtifact?.meta);
      const hasSessionContext = Boolean(
        browserAssistSessionState?.sessionId ||
          browserAssistSessionState?.profileKey ||
          readFirstString(artifactMeta ? [artifactMeta] : [], [
            "sessionId",
            "session_id",
            "profileKey",
            "profile_key",
          ]) ||
          browserAssistArtifact,
      );

      if (hasSessionContext) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        if (!targetUrl) {
          return true;
        }
        return navigateBrowserAssistCanvasToUrl(targetUrl, options);
      }

      if (!targetUrl) {
        return false;
      }

      const browserAssistScopeKey =
        currentBrowserAssistScopeKey ||
        resolveBrowserAssistSessionScopeKey(projectId, sessionId);
      const launchKey = `${generalBrowserAssistProfileKey}:${targetUrl}`;
      if (autoLaunchingBrowserAssistKeyRef.current === launchKey) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        return true;
      }
      autoLaunchingBrowserAssistKeyRef.current = launchKey;
      upsertGeneralArtifact(
        buildPendingBrowserAssistArtifact({
          scopeKey: browserAssistScopeKey,
          profileKey: generalBrowserAssistProfileKey,
          url: targetUrl,
          title: "浏览器协助",
        }),
      );
      openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
      setBrowserAssistLaunching(true);

      try {
        const result = await launchBrowserSession({
          profile_key: generalBrowserAssistProfileKey,
          url: targetUrl,
          open_window: false,
          stream_mode: "both",
        });

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId: result.session.session_id,
            profileKey: result.session.profile_key,
            url:
              result.session.last_page_info?.url?.trim() ||
              result.session.target_url?.trim() ||
              targetUrl,
            title:
              result.session.last_page_info?.title?.trim() ||
              result.session.target_title?.trim() ||
              "浏览器协助",
            targetId: result.session.target_id,
            transportKind: result.session.transport_kind,
            lifecycleState: result.session.lifecycle_state,
            controlMode: result.session.control_mode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);

        if (!options?.silent) {
          toast.success(
            `浏览器协助已启动：${
              result.session.target_title ||
              result.session.target_url ||
              targetUrl
            }`,
          );
        }
        return true;
      } catch (error) {
        upsertGeneralArtifact(
          buildFailedBrowserAssistArtifact({
            scopeKey: browserAssistScopeKey,
            profileKey: generalBrowserAssistProfileKey,
            url: targetUrl,
            title: "浏览器协助",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        autoLaunchingBrowserAssistKeyRef.current = "";
        if (!options?.silent) {
          toast.error(
            `启动浏览器协助失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return false;
      } finally {
        setBrowserAssistLaunching(false);
      }
    },
    [
      activeTheme,
      browserAssistArtifact,
      browserAssistSessionState?.profileKey,
      browserAssistSessionState?.sessionId,
      commitBrowserAssistSessionState,
      currentBrowserAssistScopeKey,
      generalBrowserAssistProfileKey,
      navigateBrowserAssistCanvasToUrl,
      openBrowserAssistCanvas,
      projectId,
      sessionId,
      upsertGeneralArtifact,
    ],
  );

  const handleOpenBrowserAssistInCanvas = useCallback(async () => {
    await ensureBrowserAssistCanvas(input, {
      navigationMode: "best-effort",
    });
  }, [ensureBrowserAssistCanvas, input]);

  useEffect(() => {
    if (
      !openBrowserAssistOnMount ||
      openBrowserAssistOnMountHandledRef.current
    ) {
      return;
    }

    openBrowserAssistOnMountHandledRef.current = true;
    void ensureBrowserAssistCanvas(initialUserPrompt || "", {
      navigationMode: "best-effort",
    });
  }, [ensureBrowserAssistCanvas, initialUserPrompt, openBrowserAssistOnMount]);

  useEffect(() => {
    if (activeTheme !== "general") {
      autoOpenedBrowserAssistSessionIdRef.current = "";
      autoLaunchingBrowserAssistKeyRef.current = "";
      browserAssistLaunchRequestIdRef.current += 1;
      return;
    }

    if (
      !browserAssistSessionState?.sessionId &&
      !browserAssistSessionState?.profileKey
    ) {
      return;
    }

    const artifactMeta = asRecord(browserAssistArtifact?.meta);
    const currentSessionId = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["sessionId", "session_id"],
    );
    const currentProfileKey = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["profileKey", "profile_key"],
    );
    const currentUrl = readFirstString(artifactMeta ? [artifactMeta] : [], [
      "url",
      "launchUrl",
    ]);
    const currentTargetId = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["targetId", "target_id"],
    );
    const currentTransportKind = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["transportKind", "transport_kind"],
    );
    const currentLifecycleState = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["lifecycleState", "lifecycle_state"],
    );
    const currentControlMode = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["controlMode", "control_mode"],
    );
    const currentTitle = browserAssistArtifact?.title?.trim();

    const nextArtifact = buildBrowserAssistArtifact({
      scopeKey:
        currentBrowserAssistScopeKey ||
        resolveBrowserAssistSessionScopeKey(projectId, sessionId),
      profileKey:
        browserAssistSessionState.profileKey ||
        currentProfileKey ||
        generalBrowserAssistProfileKey,
      browserSessionId:
        browserAssistSessionState.sessionId || currentSessionId || "",
      url:
        browserAssistSessionState.url || currentUrl || "https://www.google.com",
      title: browserAssistSessionState.title || currentTitle || "浏览器协助",
      targetId: browserAssistSessionState.targetId || currentTargetId,
      transportKind:
        browserAssistSessionState.transportKind || currentTransportKind,
      lifecycleState:
        browserAssistSessionState.lifecycleState || currentLifecycleState,
      controlMode: browserAssistSessionState.controlMode || currentControlMode,
    });

    const nextMeta = asRecord(nextArtifact.meta);
    const nextSessionId = readFirstString(nextMeta ? [nextMeta] : [], [
      "sessionId",
      "session_id",
    ]);
    const nextProfileKey = readFirstString(nextMeta ? [nextMeta] : [], [
      "profileKey",
      "profile_key",
    ]);
    const nextUrl = readFirstString(nextMeta ? [nextMeta] : [], [
      "url",
      "launchUrl",
    ]);
    const nextTargetId = readFirstString(nextMeta ? [nextMeta] : [], [
      "targetId",
      "target_id",
    ]);
    const nextTransportKind = readFirstString(nextMeta ? [nextMeta] : [], [
      "transportKind",
      "transport_kind",
    ]);
    const nextLifecycleState = readFirstString(nextMeta ? [nextMeta] : [], [
      "lifecycleState",
      "lifecycle_state",
    ]);
    const nextControlMode = readFirstString(nextMeta ? [nextMeta] : [], [
      "controlMode",
      "control_mode",
    ]);
    const currentScopeKey = resolveBrowserAssistArtifactScopeKey(
      browserAssistArtifact,
    );
    const nextScopeKey = resolveBrowserAssistArtifactScopeKey(nextArtifact);

    const shouldUpsertArtifact =
      !browserAssistArtifact ||
      currentScopeKey !== nextScopeKey ||
      currentSessionId !== nextSessionId ||
      currentProfileKey !== nextProfileKey ||
      currentUrl !== nextUrl ||
      currentTargetId !== nextTargetId ||
      currentTransportKind !== nextTransportKind ||
      currentLifecycleState !== nextLifecycleState ||
      currentControlMode !== nextControlMode ||
      currentTitle !== nextArtifact.title;

    if (shouldUpsertArtifact) {
      upsertGeneralArtifact(nextArtifact);
    }

    const autoOpenKey =
      browserAssistSessionState.sessionId ||
      `${
        browserAssistSessionState.profileKey ||
        generalBrowserAssistProfileKey
      }:${browserAssistSessionState.url || currentUrl || "pending"}`;
    if (autoOpenedBrowserAssistSessionIdRef.current !== autoOpenKey) {
      autoOpenedBrowserAssistSessionIdRef.current = autoOpenKey;
      autoOpenBrowserAssistCanvas(nextArtifact.id);
    }
  }, [
    activeTheme,
    autoOpenBrowserAssistCanvas,
    browserAssistArtifact,
    browserAssistSessionState,
    currentBrowserAssistScopeKey,
    generalBrowserAssistProfileKey,
    projectId,
    sessionId,
    upsertGeneralArtifact,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      autoLaunchingBrowserAssistKeyRef.current = "";
      browserAssistLaunchRequestIdRef.current += 1;
      return;
    }

    if (
      !browserAssistSessionState?.sessionId &&
      !browserAssistSessionState?.profileKey
    ) {
      return;
    }

    const nextSessionId = browserAssistSessionState.sessionId || "";
    const nextProfileKey =
      browserAssistSessionState.profileKey || generalBrowserAssistProfileKey;
    const nextUrl = browserAssistSessionState.url || "https://www.google.com";
    const nextTitle = browserAssistSessionState.title || "浏览器协助";

    if (nextSessionId || !nextProfileKey || !nextUrl) {
      return;
    }

    const launchKey = `${nextProfileKey}:${nextUrl}`;
    if (autoLaunchingBrowserAssistKeyRef.current === launchKey) {
      return;
    }
    autoLaunchingBrowserAssistKeyRef.current = launchKey;
    const browserAssistScopeKey =
      currentBrowserAssistScopeKey ||
      resolveBrowserAssistSessionScopeKey(projectId, sessionId);
    upsertGeneralArtifact(
      buildPendingBrowserAssistArtifact({
        scopeKey: browserAssistScopeKey,
        profileKey: nextProfileKey,
        url: nextUrl,
        title: nextTitle,
      }),
    );
    autoOpenBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
    const launchRequestId = browserAssistLaunchRequestIdRef.current + 1;
    browserAssistLaunchRequestIdRef.current = launchRequestId;
    void (async () => {
      try {
        setBrowserAssistLaunching(true);
        const result = await launchBrowserSession({
          profile_key: nextProfileKey,
          url: nextUrl,
          open_window: false,
          stream_mode: "both",
        });
        if (browserAssistLaunchRequestIdRef.current !== launchRequestId) {
          return;
        }

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId: result.session.session_id,
            profileKey: result.session.profile_key,
            url:
              result.session.last_page_info?.url?.trim() ||
              result.session.target_url?.trim() ||
              nextUrl,
            title:
              result.session.last_page_info?.title?.trim() ||
              result.session.target_title?.trim() ||
              nextTitle,
            targetId: result.session.target_id,
            transportKind: result.session.transport_kind,
            lifecycleState: result.session.lifecycle_state,
            controlMode: result.session.control_mode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        autoOpenBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
      } catch (error) {
        upsertGeneralArtifact(
          buildFailedBrowserAssistArtifact({
            scopeKey: browserAssistScopeKey,
            profileKey: nextProfileKey,
            url: nextUrl,
            title: nextTitle,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        autoLaunchingBrowserAssistKeyRef.current = "";
        console.warn("[AgentChatPage] 自动拉起浏览器协助实时会话失败:", error);
      } finally {
        if (browserAssistLaunchRequestIdRef.current === launchRequestId) {
          setBrowserAssistLaunching(false);
        }
      }
    })();
  }, [
    activeTheme,
    autoOpenBrowserAssistCanvas,
    browserAssistSessionState,
    commitBrowserAssistSessionState,
    currentBrowserAssistScopeKey,
    generalBrowserAssistProfileKey,
    projectId,
    sessionId,
    upsertGeneralArtifact,
  ]);

  return {
    browserAssistLaunching,
    isBrowserAssistReady,
    isBrowserAssistCanvasVisible,
    currentBrowserAssistScopeKey,
    ensureBrowserAssistCanvas,
    handleOpenBrowserAssistInCanvas,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  };
}
