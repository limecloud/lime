import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isAppServerBridgeAvailable } from "@/lib/api/appServerBridgeAvailability";
import {
  consumeWorkspaceRightSurfacePending,
  dismissWorkspaceRightSurfacePending,
  listWorkspaceRightSurfacePending,
  subscribeWorkspaceRightSurfacePendingChangedNotifications,
  type WorkspaceRightSurfacePendingChangedParams,
  type WorkspaceRightSurfacePendingChangedSubscriber,
  type WorkspaceRightSurfacePendingConsumeParams,
  type WorkspaceRightSurfacePendingConsumeResponse,
  type WorkspaceRightSurfacePendingDismissParams,
  type WorkspaceRightSurfacePendingDismissResponse,
  type WorkspaceRightSurfacePendingListParams,
  type WorkspaceRightSurfacePendingRequest,
} from "@/lib/api/workspaceRightSurface";
import {
  buildWorkspaceRightSurfaceAppServerPendingIntents,
  normalizeWorkspaceRightSurfaceKind,
  type WorkspaceRightSurfaceKind,
  type WorkspaceRightSurfaceIntent,
} from "./right-surface";
import type { ReviewThreadSidePanelTarget } from "./ReviewThreadSidePanelTab";
import {
  buildWorkspaceArticleWorkspaceFromPendingRequests,
  type WorkspaceArticleWorkspace,
} from "./workspaceArticleWorkspaceModel";
import {
  buildWorkspaceRightSurfacePendingBrowserIntent,
  type WorkspaceRightSurfaceBrowserIntent,
} from "./workspaceRightSurfaceBrowserIntent";

const DEFAULT_RIGHT_SURFACE_PENDING_POLL_MS = 5_000;
const DEFAULT_RIGHT_SURFACE_PENDING_EVENT_DRAIN_MS = 250;
const DEFAULT_RIGHT_SURFACE_PENDING_EVENT_LIMIT = 20;
const DEFAULT_RIGHT_SURFACE_PENDING_LIMIT = 50;

export interface UseWorkspaceRightSurfacePendingRuntimeOptions {
  enabled: boolean;
  autoRefreshEnabled?: boolean;
  workspaceId?: string | null;
  workspaceRoot?: string | null;
  sessionId?: string | null;
  pollIntervalMs?: number;
  eventDrainIntervalMs?: number;
  eventDrainLimit?: number;
  limit?: number;
  isBridgeAvailable?: () => boolean;
  listPending?: (
    params: WorkspaceRightSurfacePendingListParams,
  ) => Promise<{ pending?: WorkspaceRightSurfacePendingRequest[] }>;
  consumePending?: (
    params: WorkspaceRightSurfacePendingConsumeParams,
  ) => Promise<WorkspaceRightSurfacePendingConsumeResponse>;
  dismissPending?: (
    params: WorkspaceRightSurfacePendingDismissParams,
  ) => Promise<WorkspaceRightSurfacePendingDismissResponse>;
  drainPendingChanges?: (
    limit?: number,
  ) => Promise<WorkspaceRightSurfacePendingChangedParams[]>;
  subscribePendingChanges?: WorkspaceRightSurfacePendingChangedSubscriber;
  now?: () => number;
}

export interface WorkspaceRightSurfacePendingRuntime {
  pendingRequests: WorkspaceRightSurfacePendingRequest[];
  pendingIntents: WorkspaceRightSurfaceIntent[];
  pendingFileTarget: ReviewThreadSidePanelTarget | null;
  pendingArticleWorkspace: WorkspaceArticleWorkspace | null;
  pendingBrowserIntent: WorkspaceRightSurfaceBrowserIntent | null;
  lastError: Error | null;
  refreshPendingRequests: () => Promise<void>;
  consumePendingRequestsForSurface: (
    surfaceKind: WorkspaceRightSurfaceKind,
    requestIds?: readonly string[],
  ) => Promise<void>;
  dismissPendingRequestsForSurface: (
    surfaceKind: WorkspaceRightSurfaceKind,
    reason?: string,
  ) => Promise<void>;
}

export function buildWorkspaceRightSurfacePendingListParams({
  limit = DEFAULT_RIGHT_SURFACE_PENDING_LIMIT,
  sessionId,
  workspaceId,
  workspaceRoot,
}: Pick<
  UseWorkspaceRightSurfacePendingRuntimeOptions,
  "limit" | "sessionId" | "workspaceId" | "workspaceRoot"
>): WorkspaceRightSurfacePendingListParams | null {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);
  const normalizedWorkspaceRoot = normalizeOptionalString(workspaceRoot);
  const normalizedSessionId = normalizeOptionalString(sessionId);

  if (
    !normalizedWorkspaceId &&
    !normalizedWorkspaceRoot &&
    !normalizedSessionId
  ) {
    return null;
  }

  return {
    limit,
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
    ...(!normalizedWorkspaceId && normalizedWorkspaceRoot
      ? { workspaceRoot: normalizedWorkspaceRoot }
      : {}),
    ...(!normalizedWorkspaceId &&
    !normalizedWorkspaceRoot &&
    normalizedSessionId
      ? { sessionId: normalizedSessionId }
      : {}),
  };
}

export function useWorkspaceRightSurfacePendingRuntime({
  enabled,
  autoRefreshEnabled = enabled,
  workspaceId,
  workspaceRoot,
  sessionId,
  pollIntervalMs = DEFAULT_RIGHT_SURFACE_PENDING_POLL_MS,
  eventDrainIntervalMs = DEFAULT_RIGHT_SURFACE_PENDING_EVENT_DRAIN_MS,
  eventDrainLimit = DEFAULT_RIGHT_SURFACE_PENDING_EVENT_LIMIT,
  limit = DEFAULT_RIGHT_SURFACE_PENDING_LIMIT,
  isBridgeAvailable = isAppServerBridgeAvailable,
  listPending = listWorkspaceRightSurfacePending,
  consumePending = consumeWorkspaceRightSurfacePending,
  dismissPending = dismissWorkspaceRightSurfacePending,
  subscribePendingChanges = subscribeWorkspaceRightSurfacePendingChangedNotifications,
  drainPendingChanges,
  now = Date.now,
}: UseWorkspaceRightSurfacePendingRuntimeOptions): WorkspaceRightSurfacePendingRuntime {
  const listParams = useMemo(
    () =>
      buildWorkspaceRightSurfacePendingListParams({
        limit,
        sessionId,
        workspaceId,
        workspaceRoot,
      }),
    [limit, sessionId, workspaceId, workspaceRoot],
  );
  const scopeKey = JSON.stringify(listParams);
  const scope = useMemo(
    () => ({
      enabled,
      key: scopeKey,
      active: false,
      epoch: 0,
      listRevision: 0,
      changeRevision: 0,
    }),
    [enabled, scopeKey],
  );
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const normalizedSessionId = normalizeOptionalString(sessionId);
  const browserOwner = useMemo(
    () => ({ sessionId: normalizedSessionId }),
    [normalizedSessionId],
  );
  const currentBrowserOwner = useRef(browserOwner);
  currentBrowserOwner.current = browserOwner;
  const emptySnapshot = useMemo(
    () => ({
      scope,
      pendingRequests: [] as WorkspaceRightSurfacePendingRequest[],
      lastError: null as Error | null,
    }),
    [scope],
  );
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const { pendingRequests, lastError } =
    snapshot.scope === scope ? snapshot : emptySnapshot;
  useLayoutEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.epoch += 1;
    };
  }, [scope]);
  const isCurrent = useCallback(
    (epoch: number) =>
      currentScope.current === scope && scope.active && scope.epoch === epoch,
    [scope],
  );
  const updateSnapshot = useCallback(
    (epoch: number, update: (current: typeof snapshot) => typeof snapshot) => {
      if (!isCurrent(epoch)) return;
      setSnapshot((current) =>
        isCurrent(epoch)
          ? update(current.scope === scope ? current : emptySnapshot)
          : current,
      );
    },
    [emptySnapshot, isCurrent, scope],
  );
  const isCurrentSurface = useCallback(
    (epoch: number, surfaceKind: WorkspaceRightSurfaceKind) =>
      isCurrent(epoch) &&
      (surfaceKind !== "browser" ||
        (browserOwner.sessionId !== null &&
          currentBrowserOwner.current === browserOwner)),
    [browserOwner, isCurrent],
  );

  const refreshPendingRequests = useCallback(async () => {
    const epoch = scope.epoch;
    if (!isCurrent(epoch)) return;
    const listRevision = ++scope.listRevision;
    const changeRevision = scope.changeRevision;
    const canApply = () =>
      isCurrent(epoch) &&
      scope.listRevision === listRevision &&
      scope.changeRevision === changeRevision;
    if (!enabled || !listParams || !isBridgeAvailable()) {
      updateSnapshot(epoch, () => emptySnapshot);
      return;
    }

    try {
      const response = await listPending(listParams);
      if (!canApply()) return;
      updateSnapshot(epoch, (current) =>
        canApply()
          ? {
              ...current,
              pendingRequests: response.pending ?? [],
              lastError: null,
            }
          : current,
      );
    } catch (error) {
      if (!canApply()) return;
      updateSnapshot(epoch, (current) =>
        canApply()
          ? { ...current, pendingRequests: [], lastError: asError(error) }
          : current,
      );
    }
  }, [
    emptySnapshot,
    enabled,
    isBridgeAvailable,
    isCurrent,
    listParams,
    listPending,
    scope,
    updateSnapshot,
  ]);

  const consumePendingRequestsForSurface = useCallback(
    async (
      surfaceKind: WorkspaceRightSurfaceKind,
      requestedIds?: readonly string[],
    ) => {
      const epoch = scope.epoch;
      if (
        !enabled ||
        !isCurrentSurface(epoch, surfaceKind) ||
        !isBridgeAvailable()
      ) {
        return;
      }

      const selectedIds = requestedIds ? new Set(requestedIds) : null;
      const requestIds = pendingRequests
        .filter(
          (request) =>
            request.status === "pending" &&
            normalizeWorkspaceRightSurfaceKind(request.surfaceKind) ===
              surfaceKind &&
            (surfaceKind !== "browser" ||
              matchesBrowserSession(request, normalizedSessionId)) &&
            (!selectedIds || selectedIds.has(request.requestId)),
        )
        .map((request) => request.requestId)
        .filter((requestId) => requestId.trim().length > 0);

      if (requestIds.length === 0) {
        return;
      }

      try {
        const response = await consumePending({ requestIds });
        if (!isCurrentSurface(epoch, surfaceKind)) return;
        scope.changeRevision += 1;
        const consumedIds = new Set(response.consumedRequestIds ?? []);
        updateSnapshot(epoch, (current) =>
          isCurrentSurface(epoch, surfaceKind)
            ? {
                ...current,
                pendingRequests: current.pendingRequests.filter(
                  (request) => !consumedIds.has(request.requestId),
                ),
                lastError: null,
              }
            : current,
        );
      } catch (error) {
        updateSnapshot(epoch, (current) =>
          isCurrentSurface(epoch, surfaceKind)
            ? { ...current, lastError: asError(error) }
            : current,
        );
      }
    },
    [
      consumePending,
      enabled,
      isBridgeAvailable,
      isCurrentSurface,
      normalizedSessionId,
      pendingRequests,
      scope,
      updateSnapshot,
    ],
  );

  const dismissPendingRequestsForSurface = useCallback(
    async (surfaceKind: WorkspaceRightSurfaceKind, reason?: string) => {
      const epoch = scope.epoch;
      if (
        !enabled ||
        !isCurrentSurface(epoch, surfaceKind) ||
        !isBridgeAvailable()
      ) {
        return;
      }

      const requestIds = pendingRequests
        .filter(
          (request) =>
            request.status === "pending" &&
            normalizeWorkspaceRightSurfaceKind(request.surfaceKind) ===
              surfaceKind &&
            (surfaceKind !== "browser" ||
              matchesBrowserSession(request, normalizedSessionId)),
        )
        .map((request) => request.requestId)
        .filter((requestId) => requestId.trim().length > 0);

      if (requestIds.length === 0) {
        return;
      }

      try {
        const normalizedReason = normalizeOptionalString(reason);
        const response = await dismissPending({
          requestIds,
          ...(normalizedReason ? { reason: normalizedReason } : {}),
        });
        if (!isCurrentSurface(epoch, surfaceKind)) return;
        scope.changeRevision += 1;
        const dismissedIds = new Set(response.dismissedRequestIds ?? []);
        updateSnapshot(epoch, (current) =>
          isCurrentSurface(epoch, surfaceKind)
            ? {
                ...current,
                pendingRequests: current.pendingRequests.filter(
                  (request) => !dismissedIds.has(request.requestId),
                ),
                lastError: null,
              }
            : current,
        );
      } catch (error) {
        updateSnapshot(epoch, (current) =>
          isCurrentSurface(epoch, surfaceKind)
            ? { ...current, lastError: asError(error) }
            : current,
        );
      }
    },
    [
      dismissPending,
      enabled,
      isBridgeAvailable,
      isCurrentSurface,
      normalizedSessionId,
      pendingRequests,
      scope,
      updateSnapshot,
    ],
  );

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return undefined;
    }

    void refreshPendingRequests();
    if (!enabled || !listParams || pollIntervalMs <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshPendingRequests();
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [
    autoRefreshEnabled,
    enabled,
    listParams,
    pollIntervalMs,
    refreshPendingRequests,
  ]);

  useEffect(() => {
    if (
      !autoRefreshEnabled ||
      !enabled ||
      !listParams ||
      eventDrainIntervalMs <= 0
    ) {
      return undefined;
    }

    const epoch = scope.epoch;
    let disposed = false;
    const isActive = () => !disposed && isCurrent(epoch);
    const applyChanges = (
      changes: readonly WorkspaceRightSurfacePendingChangedParams[],
    ) => {
      if (!isActive() || changes.length === 0) {
        return;
      }
      scope.changeRevision += 1;
      updateSnapshot(epoch, (current) =>
        isActive()
          ? {
              ...current,
              pendingRequests: applyWorkspaceRightSurfacePendingChanges(
                current.pendingRequests,
                changes,
                listParams,
              ),
              lastError: null,
            }
          : current,
      );
    };

    if (!drainPendingChanges) {
      if (!isBridgeAvailable()) {
        return undefined;
      }

      const unsubscribe = subscribePendingChanges(
        {
          onChanges: applyChanges,
          onError: (error) => {
            updateSnapshot(epoch, (current) =>
              isActive() ? { ...current, lastError: asError(error) } : current,
            );
          },
        },
        {
          intervalMs: eventDrainIntervalMs,
          isBridgeAvailable,
          limit: eventDrainLimit,
        },
      );
      return () => {
        disposed = true;
        unsubscribe();
      };
    }

    let draining = false;

    const drainOnce = async () => {
      if (!isActive() || draining || !isBridgeAvailable()) {
        return;
      }

      draining = true;
      try {
        const changes = await drainPendingChanges(eventDrainLimit);
        if (!isActive() || changes.length === 0) {
          return;
        }
        applyChanges(changes);
      } catch (error) {
        updateSnapshot(epoch, (current) =>
          isActive() ? { ...current, lastError: asError(error) } : current,
        );
      } finally {
        draining = false;
      }
    };

    void drainOnce();
    const timer = window.setInterval(() => {
      void drainOnce();
    }, eventDrainIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    drainPendingChanges,
    autoRefreshEnabled,
    enabled,
    eventDrainIntervalMs,
    eventDrainLimit,
    isBridgeAvailable,
    isCurrent,
    listParams,
    scope,
    subscribePendingChanges,
    updateSnapshot,
  ]);

  const pendingIntents = useMemo(() => {
    const createdAt = now();
    return buildWorkspaceRightSurfaceAppServerPendingIntents(
      pendingRequests,
      createdAt,
    );
  }, [now, pendingRequests]);
  const pendingFileTarget = useMemo(
    () => buildWorkspaceRightSurfacePendingFileTarget(pendingRequests),
    [pendingRequests],
  );
  const pendingArticleWorkspace = useMemo(
    () => buildWorkspaceArticleWorkspaceFromPendingRequests(pendingRequests),
    [pendingRequests],
  );
  const pendingBrowserIntent = useMemo(
    () =>
      buildWorkspaceRightSurfacePendingBrowserIntent(
        pendingRequests.filter((request) =>
          matchesBrowserSession(request, normalizedSessionId),
        ),
      ),
    [normalizedSessionId, pendingRequests],
  );

  return {
    pendingRequests,
    pendingIntents,
    pendingFileTarget,
    pendingArticleWorkspace,
    pendingBrowserIntent,
    lastError,
    refreshPendingRequests,
    consumePendingRequestsForSurface,
    dismissPendingRequestsForSurface,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function matchesBrowserSession(
  request: WorkspaceRightSurfacePendingRequest,
  sessionId: string | null,
): boolean {
  const requestedSessionId = normalizeOptionalString(request.sessionId);
  return (
    sessionId !== null &&
    (!requestedSessionId || requestedSessionId === sessionId)
  );
}

export function applyWorkspaceRightSurfacePendingChanges(
  currentRequests: readonly WorkspaceRightSurfacePendingRequest[],
  changes: readonly WorkspaceRightSurfacePendingChangedParams[],
  listParams?: WorkspaceRightSurfacePendingListParams | null,
): WorkspaceRightSurfacePendingRequest[] {
  let nextRequests = [...currentRequests];

  for (const change of changes) {
    const changeType = change.changeType.trim();
    if (changeType === "requested") {
      for (const request of change.pending ?? []) {
        if (
          request.status !== "pending" ||
          !matchesPendingListParams(request, listParams)
        ) {
          continue;
        }
        nextRequests = upsertPendingRequest(nextRequests, request);
      }
      continue;
    }

    if (changeType === "consumed") {
      nextRequests = removePendingRequestIds(nextRequests, [
        ...(change.requestIds ?? []),
        ...(change.consumedRequestIds ?? []),
      ]);
      continue;
    }

    if (changeType === "dismissed") {
      nextRequests = removePendingRequestIds(nextRequests, [
        ...(change.requestIds ?? []),
        ...(change.dismissedRequestIds ?? []),
      ]);
    }
  }

  return nextRequests;
}

export function buildWorkspaceRightSurfacePendingFileTarget(
  pendingRequests: readonly WorkspaceRightSurfacePendingRequest[],
): ReviewThreadSidePanelTarget | null {
  for (const request of pendingRequests) {
    if (request.status !== "pending" || request.surfaceKind !== "files") {
      continue;
    }

    const metadata = asRecord(request.metadata);
    const relativePath = normalizePath(
      firstString(
        metadata?.relativePath,
        metadata?.path,
        metadata?.filePath,
        request.candidateId,
      ),
    );
    if (!relativePath) {
      continue;
    }

    return {
      relativePath,
      title:
        firstString(metadata?.title, metadata?.name, metadata?.filename) ??
        extractFileName(relativePath),
    };
  }

  return null;
}

function normalizeOptionalString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function matchesPendingListParams(
  request: WorkspaceRightSurfacePendingRequest,
  listParams?: WorkspaceRightSurfacePendingListParams | null,
): boolean {
  if (!listParams) {
    return true;
  }

  const workspaceId = normalizeOptionalString(listParams.workspaceId);
  if (
    workspaceId &&
    normalizeOptionalString(request.workspaceId) !== workspaceId
  ) {
    return false;
  }

  const workspaceRoot = normalizeOptionalString(listParams.workspaceRoot);
  if (
    workspaceRoot &&
    normalizeOptionalString(request.workspaceRoot) !== workspaceRoot
  ) {
    return false;
  }

  const sessionId = normalizeOptionalString(listParams.sessionId);
  if (sessionId && normalizeOptionalString(request.sessionId) !== sessionId) {
    return false;
  }

  return true;
}

function upsertPendingRequest(
  requests: WorkspaceRightSurfacePendingRequest[],
  request: WorkspaceRightSurfacePendingRequest,
): WorkspaceRightSurfacePendingRequest[] {
  const index = requests.findIndex(
    (item) => item.requestId === request.requestId,
  );
  if (index < 0) {
    return [...requests, request];
  }

  const nextRequests = [...requests];
  nextRequests[index] = request;
  return nextRequests;
}

function removePendingRequestIds(
  requests: WorkspaceRightSurfacePendingRequest[],
  requestIds: readonly string[],
): WorkspaceRightSurfacePendingRequest[] {
  const ids = new Set(
    requestIds.map((requestId) => requestId.trim()).filter(Boolean),
  );
  if (ids.size === 0) {
    return requests;
  }
  return requests.filter((request) => !ids.has(request.requestId));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizePath(value: string | null): string | null {
  const normalized = value?.replace(/\\/g, "/").trim();
  return normalized ? normalized : null;
}

function extractFileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
