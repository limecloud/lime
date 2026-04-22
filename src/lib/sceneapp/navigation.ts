import type { SceneAppPattern, SceneAppType } from "./types";

export type SceneAppsView = "catalog" | "detail" | "governance";

export interface SceneAppsPageParams {
  view?: SceneAppsView;
  sceneappId?: string;
  runId?: string;
  projectId?: string;
  prefillIntent?: string;
  referenceMemoryIds?: string[];
  search?: string;
  typeFilter?: SceneAppType;
  patternFilter?: SceneAppPattern;
}

export function normalizeSceneAppTypeFilter(value: unknown): SceneAppType | undefined {
  switch (value) {
    case "local_instant":
    case "local_durable":
    case "browser_grounded":
    case "hybrid":
      return value;
    default:
      return undefined;
  }
}

export function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalTextList(
  values?: Array<string | null | undefined> | null,
): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeSceneAppsPageParams(
  params?: Partial<SceneAppsPageParams>,
): SceneAppsPageParams {
  const normalized: SceneAppsPageParams = {};
  const view = params?.view;
  const sceneappId = normalizeOptionalText(params?.sceneappId);
  const runId = normalizeOptionalText(params?.runId);
  const projectId = normalizeOptionalText(params?.projectId);
  const prefillIntent = normalizeOptionalText(params?.prefillIntent);
  const referenceMemoryIds = normalizeOptionalTextList(
    params?.referenceMemoryIds,
  );
  const search = normalizeOptionalText(params?.search);

  if (view === "catalog" || view === "detail" || view === "governance") {
    normalized.view = view;
  }
  if (sceneappId) {
    normalized.sceneappId = sceneappId;
  }
  if (runId) {
    normalized.runId = runId;
  }
  if (projectId) {
    normalized.projectId = projectId;
  }
  if (prefillIntent) {
    normalized.prefillIntent = prefillIntent;
  }
  if (referenceMemoryIds) {
    normalized.referenceMemoryIds = referenceMemoryIds;
  }
  if (search) {
    normalized.search = search;
  }
  const typeFilter = normalizeSceneAppTypeFilter(params?.typeFilter);
  if (typeFilter) {
    normalized.typeFilter = typeFilter;
  }
  if (params?.patternFilter) {
    normalized.patternFilter = params.patternFilter;
  }

  return normalized;
}

export function serializeSceneAppsPageParams(
  params?: Partial<SceneAppsPageParams>,
): string {
  return JSON.stringify(normalizeSceneAppsPageParams(params));
}
