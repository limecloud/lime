import type { Topic } from "../hooks/agentChatShared";
import { resolveThreadTitle } from "./threadTitle";

export interface ThreadWorkspaceHeaderViewModel {
  sessionId: string;
  title: string;
  onRename?: (title: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  onFork?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

interface BuildThreadWorkspaceHeaderViewModelParams {
  sessionId?: string | null;
  currentSessionTitle?: string | null;
  initialSessionId?: string | null;
  initialSessionName?: string | null;
  topic?: Topic | null;
  onRename?: (title: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  onFork?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  untitledTaskLabel: string;
}

function normalizeText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildThreadWorkspaceHeaderViewModel({
  sessionId,
  currentSessionTitle,
  initialSessionId,
  initialSessionName,
  topic,
  onRename,
  onArchive,
  onFork,
  onDelete,
  untitledTaskLabel,
}: BuildThreadWorkspaceHeaderViewModelParams): ThreadWorkspaceHeaderViewModel | null {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const initialTitleFallback =
    normalizedSessionId === normalizeText(initialSessionId)
      ? normalizeText(initialSessionName)
      : null;
  const title = resolveThreadTitle(
    normalizeText(topic?.title) ?? normalizeText(currentSessionTitle),
    initialTitleFallback ?? untitledTaskLabel,
  );

  return {
    sessionId: normalizedSessionId,
    title,
    ...(onRename ? { onRename } : {}),
    ...(onArchive ? { onArchive } : {}),
    ...(onFork ? { onFork } : {}),
    ...(onDelete ? { onDelete } : {}),
  };
}
