import type { SceneAppRunSummary } from "./types";

export interface SceneAppRuntimeArtifactEntryLike {
  label: string;
  artifactRef: {
    relativePath?: string | null;
    absolutePath?: string | null;
    projectId?: string | null;
  };
}

function resolveSceneAppRunSortTime(
  run: Pick<SceneAppRunSummary, "finishedAt" | "startedAt">,
): number {
  const timestamp = Date.parse(run.finishedAt ?? run.startedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function hasSceneAppRunDeliveryArtifacts(
  run: Pick<SceneAppRunSummary, "deliveryArtifactRefs">,
): boolean {
  return (run.deliveryArtifactRefs?.length ?? 0) > 0;
}

export function findLatestSceneAppPackResultRun(params: {
  selectedRun: SceneAppRunSummary | null;
  runs: SceneAppRunSummary[];
}): SceneAppRunSummary | null {
  if (
    params.selectedRun &&
    hasSceneAppRunDeliveryArtifacts(params.selectedRun)
  ) {
    return params.selectedRun;
  }

  return (
    [...params.runs]
      .sort(
        (left, right) =>
          resolveSceneAppRunSortTime(right) - resolveSceneAppRunSortTime(left),
      )
      .find(hasSceneAppRunDeliveryArtifacts) ?? null
  );
}

export function resolveSceneAppRuntimeArtifactOpenTarget(params: {
  entry?: SceneAppRuntimeArtifactEntryLike;
  fallbackProjectId?: string | null;
  bannerPrefix: string;
}): {
  projectId?: string;
  openTargetPath: string;
  bannerMessage: string;
} | null {
  const { entry } = params;
  if (!entry) {
    return null;
  }

  const relativePath = entry.artifactRef.relativePath?.trim();
  const absolutePath = entry.artifactRef.absolutePath?.trim();
  const projectId =
    entry.artifactRef.projectId?.trim() ||
    params.fallbackProjectId?.trim() ||
    undefined;
  const openTargetPath = projectId
    ? relativePath || absolutePath
    : absolutePath || relativePath;

  if (!openTargetPath) {
    return null;
  }

  return {
    projectId,
    openTargetPath,
    bannerMessage: `${params.bannerPrefix}：${entry.label}。`,
  };
}
