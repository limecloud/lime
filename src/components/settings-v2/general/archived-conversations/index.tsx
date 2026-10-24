import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Folder, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  listAgentRuntimeSessions,
  deleteAgentRuntimeSession,
  unarchiveAgentRuntimeSession,
} from "@/lib/api/agentRuntime/sessionClient";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { formatDate } from "@/i18n/format";
import { cn } from "@/lib/utils";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import { DeleteArchivedChatsDialog } from "./DeleteArchivedChatsDialog";

import { listProjectDirectory } from "@/lib/api/projectDirectory";
import {
  ArchivedChatsControls,
  ArchivedProjectActions,
} from "./ArchivedChatsControls";
import {
  buildArchivedChats,
  groupArchivedChats,
  type ArchiveProject,
  type ArchivedChatSort,
} from "./archivedChats";

interface DeleteTarget {
  scope: "single" | "project" | "all";
  sessions: AgentSessionInfo[];
  projectLabel?: string;
}

function resolveTimestampMs(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value < 10_000_000_000 ? value * 1000 : value;
}

function formatSessionDate(
  value: number | null,
  locale: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return formatDate(value, {
    locale,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveWorkspaceLabel(session: AgentSessionInfo): string | null {
  const workingDir = session.working_dir?.trim();
  if (!workingDir) {
    return null;
  }

  const normalized = workingDir.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

export function ArchivedConversationsSettings() {
  const { t, i18n } = useTranslation("settings");
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [projects, setProjects] = useState<ArchiveProject[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [projectFilter, setProjectFilter] = useState("all");
  const [sort, setSort] = useState<ArchivedChatSort>("updated");
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const operation = useRef(false);
  const loadGeneration = useRef(0);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const pageBody = useRef<HTMLDivElement>(null);
  const busy = restoringSessionId !== null || deleting;
  useSettingsDraft({ dirty: false, saving: busy });
  const untitledLabel = t(
    "settings.archivedConversations.untitled",
    "未命名对话",
  );
  const entries = useMemo(
    () => buildArchivedChats(sessions, projects, untitledLabel),
    [sessions, projects, untitledLabel],
  );
  const effectiveProjectFilter =
    projectFilter === "all" ||
    projectFilter === "none" ||
    projects.some((project) => `project:${project.id}` === projectFilter)
      ? projectFilter
      : "all";
  const groups = useMemo(
    () =>
      groupArchivedChats({
        entries,
        projectFilter: effectiveProjectFilter,
        query: deferredQuery,
        sort,
      }),
    [entries, effectiveProjectFilter, deferredQuery, sort],
  );

  const loadArchivedSessions = useCallback(async () => {
    if (operation.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const [nextSessions, nextProjects] = await Promise.all([
        listAgentRuntimeSessions({ archivedOnly: true }),
        listProjectDirectory(),
      ]);
      if (loadGeneration.current !== generation) return;
      setSessions(
        nextSessions.filter((session) => Boolean(session.archived_at)),
      );
      setProjects(nextProjects);
    } catch (loadError) {
      if (loadGeneration.current !== generation) return;
      console.error("加载已归档对话失败:", loadError);
      setError(
        t("settings.archivedConversations.error.load", "加载已归档对话失败"),
      );
      setSessions([]);
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadArchivedSessions();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadArchivedSessions]);

  const handleRestore = useCallback(
    async (session: AgentSessionInfo) => {
      if (operation.current || loading || deleteTarget) return;
      operation.current = true;
      loadGeneration.current += 1;
      setRestoringSessionId(session.id);
      try {
        await unarchiveAgentRuntimeSession(session.id);
        setSessions((current) =>
          current.filter((item) => item.id !== session.id),
        );
        toast.success(
          t("settings.archivedConversations.toast.restored", "已恢复对话"),
        );
      } catch (restoreError) {
        console.error("恢复已归档对话失败:", restoreError);
        toast.error(
          t(
            "settings.archivedConversations.toast.restoreFailed",
            "恢复失败，请稍后重试",
          ),
        );
      } finally {
        operation.current = false;
        setRestoringSessionId(null);
      }
    },
    [t, loading, deleteTarget],
  );

  async function handleDelete() {
    if (!deleteTarget || operation.current) return;
    operation.current = true;
    loadGeneration.current += 1;
    setDeleting(true);
    setDeleteFailed(false);
    const failed: AgentSessionInfo[] = [];
    try {
      for (const session of deleteTarget.sessions) {
        try {
          await deleteAgentRuntimeSession(session.id);
          setSessions((current) =>
            current.filter((item) => item.id !== session.id),
          );
        } catch {
          failed.push(session);
        }
      }
      if (failed.length) {
        setDeleteTarget({ ...deleteTarget, sessions: failed });
        setDeleteFailed(true);
      } else {
        setDeleteTarget(null);
        toast.success(t("settings.archivedConversations.toast.deleted"));
      }
    } finally {
      operation.current = false;
      setDeleting(false);
    }
  }

  function beginDelete(target: DeleteTarget, trigger: HTMLButtonElement) {
    if (operation.current || loading || deleteTarget) return;
    deleteTrigger.current = trigger;
    setDeleteFailed(false);
    setDeleteTarget(target);
  }

  return (
    <SettingsPageBody
      ref={pageBody}
      tabIndex={-1}
      data-testid="settings-archived-conversations"
    >
      <SettingsPageHeader
        title={t("settings.desktop.archivedChats")}
        actions={
          entries.length ? (
            <SettingsAction
              type="button"
              $tone="danger"
              aria-label={t("settings.archivedConversations.action.deleteAll")}
              disabled={loading || busy || deleteTarget !== null}
              data-testid="settings-archived-delete-all"
              onClick={(event) =>
                beginDelete(
                  {
                    scope: "all",
                    sessions: entries.map((entry) => entry.session),
                  },
                  event.currentTarget,
                )
              }
            >
              <Trash2 aria-hidden="true" />
              <span className="hidden min-[1100px]:inline">
                {t("settings.archivedConversations.action.deleteAll")}
              </span>
            </SettingsAction>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        <div
          className="sticky z-10 pb-2"
          style={{
            top: "calc(-1 * var(--settings-content-padding-top, 0px))",
            background: "var(--lime-settings-surface, hsl(var(--background)))",
          }}
          data-testid="settings-archived-controls"
        >
          <ArchivedChatsControls
            query={query}
            projectFilter={effectiveProjectFilter}
            sort={sort}
            projects={projects}
            disabled={loading || busy || deleteTarget !== null}
            onQuery={setQuery}
            onProject={setProjectFilter}
            onSort={setSort}
          />
        </div>

        {loading ? (
          <SettingsEmptyState
            role="status"
            aria-live="polite"
            aria-busy="true"
            data-testid="settings-archived-conversations-loading"
          >
            {t("settings.archivedConversations.status.loading")}
          </SettingsEmptyState>
        ) : error ? (
          <SettingsEmptyState
            role="alert"
            data-testid="settings-archived-conversations-error"
          >
            <p className="mb-3 text-destructive">{error}</p>
            <SettingsAction
              type="button"
              onClick={() => void loadArchivedSessions()}
              data-testid="settings-archived-conversations-retry"
            >
              {t("settings.archivedConversations.action.retry")}
            </SettingsAction>
          </SettingsEmptyState>
        ) : entries.length === 0 ? (
          <SettingsEmptyState
            role="status"
            aria-live="polite"
            data-testid="settings-archived-conversations-empty"
          >
            {t("settings.archivedConversations.empty.title")}
          </SettingsEmptyState>
        ) : groups.length === 0 ? (
          <SettingsEmptyState
            role="status"
            data-testid="settings-archived-no-results"
          >
            {t("settings.archivedConversations.noResults")}
          </SettingsEmptyState>
        ) : (
          groups.map((group) => (
            <SettingsSection
              key={group.id}
              title={
                effectiveProjectFilter === "all" ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">
                      {group.projectLabel ??
                        t("settings.archivedConversations.noProject")}
                    </span>
                  </span>
                ) : undefined
              }
              actions={
                effectiveProjectFilter === "all" ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">
                      {t("settings.archivedConversations.groupCount", {
                        count: group.entries.length,
                      })}
                    </span>
                    {group.projectLabel ? (
                      <ArchivedProjectActions
                        disabled={busy || deleteTarget !== null}
                        onDelete={(trigger) =>
                          beginDelete(
                            {
                              scope: "project",
                              projectLabel: group.projectLabel!,
                              sessions: group.entries.map(
                                (entry) => entry.session,
                              ),
                            },
                            trigger,
                          )
                        }
                      />
                    ) : null}
                  </span>
                ) : undefined
              }
            >
              <SettingsGroup>
                {group.entries.map(({ session, title }) => {
                  const updatedAt = formatSessionDate(
                    resolveTimestampMs(
                      session.updated_at || session.created_at,
                    ),
                    i18n.language,
                  );
                  const workspace = effectiveProjectFilter.startsWith(
                    "project:",
                  )
                    ? resolveWorkspaceLabel(session)
                    : null;
                  const restoring = restoringSessionId === session.id;
                  return (
                    <SettingsRow
                      key={session.id}
                      label={<span className="block truncate">{title}</span>}
                      description={[updatedAt, workspace]
                        .filter(Boolean)
                        .join(" • ")}
                      data-testid="settings-archived-conversation"
                      data-session-id={session.id}
                    >
                      <SettingsAction
                        type="button"
                        $tone="danger"
                        disabled={busy || deleteTarget !== null}
                        aria-label={t(
                          "settings.archivedConversations.action.deleteWithTitle",
                          { title },
                        )}
                        title={t(
                          "settings.archivedConversations.action.delete",
                        )}
                        data-testid="settings-archived-conversation-delete"
                        data-session-id={session.id}
                        onClick={(event) => {
                          beginDelete(
                            { scope: "single", sessions: [session] },
                            event.currentTarget,
                          );
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </SettingsAction>
                      <SettingsAction
                        type="button"
                        disabled={busy || deleteTarget !== null}
                        onClick={() => void handleRestore(session)}
                        data-testid="settings-archived-conversation-restore"
                        data-session-id={session.id}
                      >
                        <RotateCcw
                          className={cn(restoring && "animate-spin")}
                          aria-hidden="true"
                        />
                        {t(
                          restoring
                            ? "settings.archivedConversations.action.restoring"
                            : "settings.archivedConversations.action.restore",
                        )}
                      </SettingsAction>
                    </SettingsRow>
                  );
                })}
              </SettingsGroup>
            </SettingsSection>
          ))
        )}
      </div>
      {entries.length ? (
        <div className="flex justify-end">
          <SettingsAction
            type="button"
            onClick={() => void loadArchivedSessions()}
            disabled={loading || busy || deleteTarget !== null}
          >
            <RefreshCw aria-hidden="true" />
            {t("settings.archivedConversations.action.refresh")}
          </SettingsAction>
        </div>
      ) : null}
      {deleteTarget ? (
        <DeleteArchivedChatsDialog
          scope={deleteTarget.scope}
          count={deleteTarget.sessions.length}
          projectLabel={deleteTarget.projectLabel}
          pending={deleting}
          failed={deleteFailed}
          onConfirm={() => void handleDelete()}
          onClose={() => {
            if (!operation.current) setDeleteTarget(null);
          }}
          onRestoreFocus={() => {
            if (deleteTrigger.current?.isConnected)
              deleteTrigger.current.focus();
            else pageBody.current?.focus();
          }}
        />
      ) : null}
    </SettingsPageBody>
  );
}
