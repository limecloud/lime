import type { AgentThreadItem, SiteSavedContentTarget } from "../types";
import { isHiddenConversationArtifactPath } from "../utils/internalArtifactVisibility";
import { extractFileNameFromPath } from "./workspacePath";
import { scorePreferredResultFilePath } from "./resultFilePriority";

export interface ServiceSkillResultFileTarget {
  relativePath: string;
  title: string;
}

function normalizePath(value?: string | null): string {
  return (value || "").trim().replace(/\\/g, "/");
}

function isMarkdownLikePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt|rst|adoc)$/i.test(path);
}

function scoreResultFileCandidate(
  path: string,
  sequence: number,
): number {
  return sequence + scorePreferredResultFilePath(path);
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

  const savedPath = normalizePath(
    params.savedContentTarget?.projectFile?.relativePath || undefined,
  );

  if (savedPath) {
    candidates.push({
      id: "__saved-content-target__",
      thread_id: "",
      turn_id: "",
      sequence: -1,
      status: "completed",
      started_at: "",
      completed_at: "",
      updated_at: "",
      type: "file_artifact",
      path: savedPath,
      source: "write_file",
      content: "",
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const preferred = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreResultFileCandidate(
        right.path,
        right.sequence,
      ) -
      scoreResultFileCandidate(
        left.path,
        left.sequence,
      );
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return right.sequence - left.sequence;
  })[0];

  const normalizedPath = normalizePath(preferred?.path);
  if (!preferred || !normalizedPath) {
    return null;
  }

  return {
    relativePath: normalizedPath,
    title: extractFileNameFromPath(normalizedPath),
  };
}
