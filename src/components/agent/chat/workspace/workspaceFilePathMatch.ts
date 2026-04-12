import { normalizeArtifactProtocolPath } from "@/lib/artifact-protocol";
import { extractFileNameFromPath } from "./workspacePath";

export function shouldAllowBareFileNameFallback(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) {
    return false;
  }

  if (normalized.includes("/")) {
    return false;
  }

  return !/^(\/|[A-Za-z]:\/|\/\/)/.test(normalized);
}

export function doesWorkspaceFileCandidateMatch(
  candidatePath?: string | null,
  targetPath?: string | null,
): boolean {
  const normalizedCandidate = normalizeArtifactProtocolPath(candidatePath);
  const normalizedTarget = normalizeArtifactProtocolPath(targetPath);

  if (!normalizedCandidate || !normalizedTarget) {
    return false;
  }

  if (normalizedCandidate === normalizedTarget) {
    return true;
  }

  if (!shouldAllowBareFileNameFallback(normalizedTarget)) {
    return false;
  }

  return extractFileNameFromPath(normalizedCandidate) === normalizedTarget;
}
