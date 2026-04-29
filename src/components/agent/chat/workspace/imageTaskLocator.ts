import type { MediaTaskLookupRequest } from "@/lib/api/mediaTasks";

export const IMAGE_TASKS_ROOT_RELATIVE_PATH = ".lime/tasks";

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimLeadingDotSlash(value: string): string {
  return value.replace(/^\.\//, "").replace(/^\.[\\/]/, "");
}

function trimLeadingSlashes(value: string): string {
  return value.replace(/^[\\/]+/, "");
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

export function normalizeImageTaskPath(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveImageTaskWorkspaceRoot(params: {
  taskFilePath?: string | null;
  artifactPath?: string | null;
  fallbackProjectRootPath?: string | null;
}): string | undefined {
  const normalizedTaskFilePath = normalizeImageTaskPath(params.taskFilePath);
  if (!normalizedTaskFilePath) {
    return normalizeImageTaskPath(params.fallbackProjectRootPath);
  }

  const normalizedAbsolutePath = normalizePathSeparators(
    normalizedTaskFilePath,
  );
  const normalizedArtifactPath = normalizeImageTaskPath(params.artifactPath);
  if (normalizedArtifactPath) {
    const artifactSuffix = trimLeadingSlashes(
      normalizePathSeparators(trimLeadingDotSlash(normalizedArtifactPath)),
    );
    if (artifactSuffix && normalizedAbsolutePath.endsWith(artifactSuffix)) {
      const root = trimTrailingSlashes(
        normalizedAbsolutePath.slice(
          0,
          normalizedAbsolutePath.length - artifactSuffix.length,
        ),
      );
      if (root) {
        return root;
      }
    }
  }

  const normalizedArtifactRoot = trimLeadingSlashes(
    normalizePathSeparators(
      trimLeadingDotSlash(IMAGE_TASKS_ROOT_RELATIVE_PATH),
    ),
  );
  const marker = `/${normalizedArtifactRoot}/`;
  const markerIndex = normalizedAbsolutePath.lastIndexOf(marker);
  if (markerIndex > 0) {
    return normalizedAbsolutePath.slice(0, markerIndex);
  }

  return normalizeImageTaskPath(params.fallbackProjectRootPath);
}

export function buildImageTaskLookupRequest(params: {
  taskId?: string | null;
  taskFilePath?: string | null;
  artifactPath?: string | null;
  projectRootPath?: string | null;
}): MediaTaskLookupRequest | null {
  const taskId = normalizeImageTaskPath(params.taskId);
  const taskFilePath = normalizeImageTaskPath(params.taskFilePath);
  const taskRef = taskFilePath || taskId;
  if (!taskRef) {
    return null;
  }

  const projectRootPath =
    resolveImageTaskWorkspaceRoot({
      taskFilePath,
      artifactPath: params.artifactPath,
      fallbackProjectRootPath: params.projectRootPath,
    }) || normalizeImageTaskPath(params.projectRootPath);
  if (!projectRootPath) {
    return null;
  }

  return {
    projectRootPath,
    taskRef,
  };
}
