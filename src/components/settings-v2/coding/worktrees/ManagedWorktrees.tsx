import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listManagedWorktrees,
  type ManagedWorktree,
} from "@/lib/api/worktrees";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsSection,
} from "../../SettingsPrimitives";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import {
  useWorktreeNavigation,
  type WorktreeNavigationProps,
} from "./useWorktreeNavigation";

export function ManagedWorktrees({ onNavigate }: WorktreeNavigationProps) {
  const { t } = useTranslation("settings");
  const navigation = useWorktreeNavigation({ onNavigate });
  const [entries, setEntries] = useState<ManagedWorktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ManagedWorktree | null>(null);
  const epoch = useRef({ version: 0 });
  const inFlight = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    const request = ++epoch.current.version;
    inFlight.current++;
    if (!quiet) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const result = await listManagedWorktrees();
      if (request === epoch.current.version) {
        setEntries(result.worktrees);
        setFailed(false);
      }
    } catch {
      if (!quiet && request === epoch.current.version) setFailed(true);
    } finally {
      inFlight.current--;
      if (request === epoch.current.version) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const token = epoch.current;
    void refresh();
    return () => {
      ++token.version;
    };
  }, [refresh]);
  useEffect(() => {
    if (selected || navigation.pending) return;
    const timer = window.setInterval(() => {
      if (!inFlight.current) void refresh(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selected, navigation.pending, refresh]);
  const repositories = new Map<string, ManagedWorktree[]>();
  for (const entry of entries) {
    const group = repositories.get(entry.repositoryRoot) ?? [];
    group.push(entry);
    repositories.set(entry.repositoryRoot, group);
  }
  return (
    <SettingsSection
      id="worktrees-managed"
      data-settings-search-target="worktrees-managed"
      tabIndex={-1}
      title={t("settings.worktrees.managed")}
      actions={
        <SettingsAction
          type="button"
          disabled={loading || selected !== null || navigation.pending !== null}
          onClick={() => void refresh()}
        >
          {t("settings.worktrees.refresh")}
        </SettingsAction>
      }
      aria-busy={loading}
    >
      {loading ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.worktrees.listLoading")}
        </p>
      ) : failed ? (
        <div
          role="alert"
          className="text-[13px] text-[color:var(--lime-danger)]"
        >
          {t("settings.worktrees.listFailed")}
        </div>
      ) : entries.length === 0 ? (
        <SettingsGroup>
          <SettingsEmptyState>
            {t("settings.worktrees.empty")}
          </SettingsEmptyState>
        </SettingsGroup>
      ) : (
        <div className="flex min-w-0 flex-col gap-6">
          {Array.from(repositories, ([repository, worktrees]) => (
            <div key={repository} className="min-w-0">
              <h3 className="mb-3 break-all text-[13px] font-medium">
                {repository}
              </h3>
              <SettingsGroup>
                {worktrees.map((entry) => {
                  const pinned = entry.threads.some((thread) => thread.pinned);
                  const active = entry.threads.some((thread) => thread.active);
                  return (
                    <div
                      key={entry.worktreePath}
                      data-worktree-path={entry.worktreePath}
                      className="flex min-w-0 flex-col gap-2 border-b border-border py-3 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-52">
                          <div className="text-[13px] font-medium">
                            {t("settings.worktrees.rowTitle")}
                          </div>
                          <div className="mt-1 break-all text-[12px] text-muted-foreground">
                            {entry.worktreePath}
                          </div>
                          {pinned || active ? (
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {t(
                                pinned
                                  ? "settings.worktrees.pinned"
                                  : "settings.worktrees.active",
                              )}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {t("settings.worktrees.newChatDescription")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <SettingsAction
                            type="button"
                            disabled={
                              !navigation.available ||
                              navigation.pending !== null
                            }
                            aria-busy={
                              navigation.pending === entry.worktreePath
                            }
                            onClick={() =>
                              void navigation.open(entry.worktreePath)
                            }
                          >
                            {t("settings.worktrees.newChat")}
                          </SettingsAction>
                          <SettingsAction
                            type="button"
                            disabled={
                              pinned || active || navigation.pending !== null
                            }
                            onClick={() => setSelected(entry)}
                            aria-label={t("settings.worktrees.deleteLabel", {
                              path: entry.worktreePath,
                            })}
                          >
                            <span className="text-[color:var(--lime-danger)]">
                              {t("settings.worktrees.delete")}
                            </span>
                          </SettingsAction>
                        </div>
                      </div>
                      {navigation.failed === entry.worktreePath ? (
                        <p
                          role="alert"
                          className="text-[12px] text-[color:var(--lime-danger)]"
                        >
                          {t("settings.worktrees.openFailed")}
                        </p>
                      ) : null}
                      <div className="text-[12px] text-muted-foreground">
                        {t("settings.worktrees.conversations")}
                      </div>
                      {entry.threads.length ? (
                        <ul className="space-y-1">
                          {entry.threads.map((thread) => (
                            <li key={thread.threadId} className="text-[13px]">
                              <button
                                type="button"
                                disabled={
                                  !navigation.available ||
                                  navigation.pending !== null
                                }
                                onClick={() =>
                                  void navigation.open(
                                    entry.worktreePath,
                                    thread.threadId,
                                  )
                                }
                                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                              >
                                <span className="min-w-0 truncate">
                                  {thread.name ||
                                    t("settings.worktrees.untitled")}
                                </span>
                                {thread.archived ? (
                                  <span className="ml-2 text-[12px] text-muted-foreground">
                                    {t("settings.worktrees.archived")}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          {t("settings.worktrees.noConversations")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </SettingsGroup>
            </div>
          ))}
        </div>
      )}
      {selected ? (
        <DeleteWorktreeDialog
          key={selected.worktreePath}
          entry={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            void refresh();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
