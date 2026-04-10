import type { AgentThreadItem, SiteSavedContentTarget } from "../types";
import { isHiddenConversationArtifactPath } from "../utils/internalArtifactVisibility";
import { extractFileNameFromPath } from "./workspacePath";

export interface ServiceSkillResultFileTarget {
  relativePath: string;
  title: string;
}

function normalizePath(value?: string | null): string {
  return (value || "").trim().replace(/\\/g, "/");
}

function normalizeDirectory(value?: string | null): string {
  const normalized = normalizePath(value);
  if (!normalized) {
    return "";
  }

  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function isMarkdownLikePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt|rst|adoc)$/i.test(path);
}

function scoreResultFileCandidate(
  item: Extract<AgentThreadItem, { type: "file_artifact" }>,
  savedContentTarget?: SiteSavedContentTarget | null,
): number {
  const normalizedPath = normalizePath(item.path);
  const savedPath = normalizePath(
    savedContentTarget?.projectFile?.relativePath || undefined,
  );
  const savedDirectory = normalizeDirectory(savedPath);
  const fileName = extractFileNameFromPath(normalizedPath).toLowerCase();
  const inSavedBundle =
    Boolean(savedPath) &&
    (normalizedPath === savedPath ||
      (savedDirectory.length > 0 &&
        normalizedPath.startsWith(`${savedDirectory}/`)));
  const outsideExports = !normalizedPath.startsWith("exports/");

  let score = item.sequence;

  if (fileName === "index.md") {
    score += 600;
  } else if (fileName === "agents.md") {
    score += 260;
  } else if (isMarkdownLikePath(normalizedPath)) {
    score += 380;
  }

  if (outsideExports) {
    score += 240;
  }

  if (!inSavedBundle) {
    score += 420;
  } else {
    score -= 320;
  }

  if ((item.content || "").trim().length > 0) {
    score += 8;
  }

  return score;
}

export function resolvePreferredServiceSkillResultFileTarget(params: {
  threadItems: AgentThreadItem[];
  savedContentTarget?: SiteSavedContentTarget | null;
}): ServiceSkillResultFileTarget | null {
  const candidates = params.threadItems.filter(
    (item): item is Extract<AgentThreadItem, { type: "file_artifact" }> =>
      item.type === "file_artifact" &&
      !isHiddenConversationArtifactPath(item.path) &&
      isMarkdownLikePath(normalizePath(item.path)),
  );

  if (candidates.length === 0) {
    return null;
  }

  const preferred = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreResultFileCandidate(right, params.savedContentTarget) -
      scoreResultFileCandidate(left, params.savedContentTarget);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return right.sequence - left.sequence;
  })[0];

  const normalizedPath = normalizePath(preferred?.path);
  if (!preferred || !normalizedPath) {
    return null;
  }

  const savedPath = normalizePath(
    params.savedContentTarget?.projectFile?.relativePath || undefined,
  );
  const savedDirectory = normalizeDirectory(savedPath);
  if (savedPath && normalizedPath === savedPath) {
    return null;
  }
  if (
    savedDirectory &&
    normalizedPath.startsWith(`${savedDirectory}/`)
  ) {
    return null;
  }

  return {
    relativePath: normalizedPath,
    title: extractFileNameFromPath(normalizedPath),
  };
}
