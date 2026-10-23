import { getConfig, updateConfig } from "./appConfig";

export interface WorktreePreferences {
  root: string;
  "upstream-refresh-mode": "never" | "best-effort";
  "auto-cleanup-enabled": boolean;
  "keep-count": number;
}

export const DEFAULT_WORKTREE_PREFERENCES: Readonly<WorktreePreferences> = {
  root: "",
  "upstream-refresh-mode": "never",
  "auto-cleanup-enabled": true,
  "keep-count": 15,
};

export async function getWorktreePreferences(): Promise<WorktreePreferences> {
  return {
    ...DEFAULT_WORKTREE_PREFERENCES,
    ...(await getConfig({ forceRefresh: true })).worktrees,
  };
}

export async function updateWorktreePreference<
  K extends keyof WorktreePreferences,
>(key: K, value: WorktreePreferences[K]): Promise<WorktreePreferences> {
  const result = await updateConfig((current) => ({
    ...current,
    worktrees: { ...current.worktrees, [key]: value },
  }));
  return { ...DEFAULT_WORKTREE_PREFERENCES, ...result.worktrees };
}
