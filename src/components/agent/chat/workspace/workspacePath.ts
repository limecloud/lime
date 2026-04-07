function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAbsoluteLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function joinWorkspacePath(rootPath: string, filePath: string): string {
  return `${rootPath.replace(/[\\/]+$/, "")}/${filePath.replace(/^[\\/]+/, "")}`;
}

export function extractFileNameFromPath(
  path: string | null | undefined,
): string {
  const normalized = normalizeWorkspacePath(path?.trim() || "");
  if (!normalized) {
    return "未命名文件";
  }

  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

export function resolveAbsoluteWorkspacePath(
  workspaceRoot: string | null | undefined,
  filePath: string | null | undefined,
): string | undefined {
  const normalizedFilePath = filePath?.trim();
  if (!normalizedFilePath) {
    return undefined;
  }

  if (isAbsoluteLikePath(normalizedFilePath)) {
    return normalizedFilePath;
  }

  const normalizedWorkspaceRoot = workspaceRoot?.trim();
  if (!normalizedWorkspaceRoot) {
    return normalizedFilePath;
  }

  return joinWorkspacePath(normalizedWorkspaceRoot, normalizedFilePath);
}
