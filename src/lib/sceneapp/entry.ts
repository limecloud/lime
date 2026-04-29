import type { SceneAppsPageParams } from "./navigation";
import { normalizeSceneAppsPageParams } from "./navigation";
import { getLatestSceneAppRecentVisit } from "./storage";

export type SceneAppsPageEntryMode =
  | "browse"
  | "resume_latest"
  | "prefer_latest";

interface ResolveSceneAppsPageEntryParamsOptions {
  mode?: SceneAppsPageEntryMode;
}

function hasParams(params: SceneAppsPageParams): boolean {
  return Object.keys(params).length > 0;
}

export function resolveSceneAppsPageEntryParams(
  params?: Partial<SceneAppsPageParams>,
  options?: ResolveSceneAppsPageEntryParamsOptions,
): SceneAppsPageParams {
  const normalizedParams = normalizeSceneAppsPageParams(params);
  const latestVisit = getLatestSceneAppRecentVisit();
  const latestParams = latestVisit
    ? normalizeSceneAppsPageParams(latestVisit)
    : null;
  const mode = options?.mode ?? "browse";

  if (mode === "resume_latest") {
    return latestParams ?? normalizedParams;
  }

  if (mode === "prefer_latest" && !hasParams(normalizedParams)) {
    return latestParams ?? normalizedParams;
  }

  return normalizedParams;
}

export function hasSceneAppRecentVisit(): boolean {
  return Boolean(getLatestSceneAppRecentVisit());
}
