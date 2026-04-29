import type { SceneAppsPageParams } from "./navigation";
import {
  normalizeSceneAppsPageParams,
  serializeSceneAppsPageParams,
} from "./navigation";

const SCENEAPP_RECENT_VISITS_STORAGE_KEY = "lime:sceneapp-recent-visits:v1";
const SCENEAPP_RECENT_VISITS_CHANGE_EVENT =
  "lime:sceneapp-recent-visits-changed";
const MAX_SCENEAPP_RECENT_VISITS = 6;

export interface SceneAppRecentVisitRecord extends SceneAppsPageParams {
  visitedAt: number;
}

function buildRecentVisitScopeKey(
  params: Pick<SceneAppsPageParams, "projectId" | "sceneappId">,
): string | null {
  if (!params.sceneappId) {
    return null;
  }

  return `${params.sceneappId}::${params.projectId ?? ""}`;
}

function readRecentVisitRecord(
  value: unknown,
): SceneAppRecentVisitRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<SceneAppRecentVisitRecord>;
  if (
    typeof record.visitedAt !== "number" ||
    !Number.isFinite(record.visitedAt)
  ) {
    return null;
  }

  const params = normalizeSceneAppsPageParams(record);
  if (!params.sceneappId) {
    return null;
  }

  return {
    ...params,
    visitedAt: record.visitedAt,
  };
}

export function listSceneAppRecentVisits(): SceneAppRecentVisitRecord[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SCENEAPP_RECENT_VISITS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => readRecentVisitRecord(entry))
      .filter((entry): entry is SceneAppRecentVisitRecord => Boolean(entry))
      .sort((left, right) => right.visitedAt - left.visitedAt)
      .slice(0, MAX_SCENEAPP_RECENT_VISITS);
  } catch {
    return [];
  }
}

export function getLatestSceneAppRecentVisit(): SceneAppRecentVisitRecord | null {
  return listSceneAppRecentVisits()[0] ?? null;
}

function emitSceneAppRecentVisitsChanged(
  records: SceneAppRecentVisitRecord[],
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SceneAppRecentVisitRecord[]>(
      SCENEAPP_RECENT_VISITS_CHANGE_EVENT,
      {
        detail: records,
      },
    ),
  );
}

export function subscribeSceneAppRecentVisits(
  listener: (records: SceneAppRecentVisitRecord[]) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const notify = () => {
    listener(listSceneAppRecentVisits());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SCENEAPP_RECENT_VISITS_STORAGE_KEY) {
      return;
    }

    notify();
  };
  const handleChangeEvent = () => {
    notify();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(
    SCENEAPP_RECENT_VISITS_CHANGE_EVENT,
    handleChangeEvent,
  );

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      SCENEAPP_RECENT_VISITS_CHANGE_EVENT,
      handleChangeEvent,
    );
  };
}

export function recordSceneAppRecentVisit(
  params: Partial<SceneAppsPageParams>,
  options?: {
    visitedAt?: number;
  },
): SceneAppRecentVisitRecord[] {
  const normalizedParams = normalizeSceneAppsPageParams(params);
  if (!normalizedParams.sceneappId) {
    return listSceneAppRecentVisits();
  }

  const nextRecord: SceneAppRecentVisitRecord = {
    ...normalizedParams,
    visitedAt: options?.visitedAt ?? Date.now(),
  };
  const nextScopeKey = buildRecentVisitScopeKey(normalizedParams);
  const nextRecords = [
    nextRecord,
    ...listSceneAppRecentVisits().filter((record) => {
      const currentScopeKey = buildRecentVisitScopeKey(record);
      if (nextScopeKey && currentScopeKey) {
        return currentScopeKey !== nextScopeKey;
      }
      return (
        serializeSceneAppsPageParams(record) !==
        serializeSceneAppsPageParams(nextRecord)
      );
    }),
  ].slice(0, MAX_SCENEAPP_RECENT_VISITS);

  if (typeof window === "undefined" || !window.localStorage) {
    return nextRecords;
  }

  try {
    window.localStorage.setItem(
      SCENEAPP_RECENT_VISITS_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write failures
  }

  emitSceneAppRecentVisitsChanged(nextRecords);

  return nextRecords;
}
