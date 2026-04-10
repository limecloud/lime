import { normalizeArtifactProtocolPath } from "@/lib/artifact-protocol";

function normalizeArtifactPath(path?: string | null): string {
  return path ? normalizeArtifactProtocolPath(path) : "";
}

export function isHiddenInternalArtifactPath(path?: string | null): boolean {
  const normalizedPath = normalizeArtifactPath(path);
  if (!normalizedPath || !normalizedPath.endsWith(".json")) {
    return false;
  }

  return (
    normalizedPath.startsWith(".lime/tasks/") ||
    normalizedPath.includes("/.lime/tasks/")
  );
}

export function isHiddenConversationArtifactPath(
  path?: string | null,
): boolean {
  const normalizedPath = normalizeArtifactPath(path);
  if (!normalizedPath) {
    return false;
  }

  if (isHiddenInternalArtifactPath(normalizedPath)) {
    return true;
  }

  const isInternalArtifactDocument =
    normalizedPath.endsWith(".artifact.json") &&
    (normalizedPath.startsWith(".lime/artifacts/") ||
      normalizedPath.includes("/.lime/artifacts/"));

  return isInternalArtifactDocument;
}
