import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  listAgentRuntimeSessions,
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
} from "../../SettingsPrimitives";
import { resolveSidebarSessionTitle } from "@/components/app-sidebar/sidebarSessionFormatting";

const ARCHIVED_CONVERSATIONS_PAGE_SIZE = 80;

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
  const workspaceId = session.workspace_id?.trim();
  if (workspaceId) {
    return workspaceId;
  }

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
  const untitledLabel = t(
    "settings.archivedConversations.untitled",
    "未命名对话",
  );
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((left, right) => {
        const leftTime = left.archived_at ?? left.updated_at ?? left.created_at;
        const rightTime =
          right.archived_at ?? right.updated_at ?? right.created_at;
        return rightTime - leftTime;
      }),
    [sessions],
  );

  const loadArchivedSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSessions = await listAgentRuntimeSessions({
        archivedOnly: true,
        limit: ARCHIVED_CONVERSATIONS_PAGE_SIZE,
      });
      setSessions(
        nextSessions.filter((session) => Boolean(session.archived_at)),
      );
    } catch (loadError) {
      console.error("加载已归档对话失败:", loadError);
      setError(
        t("settings.archivedConversations.error.load", "加载已归档对话失败"),
      );
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadArchivedSessions();
  }, [loadArchivedSessions]);

  const handleRestore = useCallback(
    async (session: AgentSessionInfo) => {
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
        setRestoringSessionId(null);
      }
    },
    [t],
  );

  return (
    <SettingsPageBody data-testid="settings-archived-conversations">
      <SettingsPageHeader title={t("settings.desktop.archivedChats")} />
      <SettingsGroup>
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
        ) : sortedSessions.length === 0 ? (
          <SettingsEmptyState
            role="status"
            aria-live="polite"
            data-testid="settings-archived-conversations-empty"
          >
            {t("settings.archivedConversations.empty.title")}
          </SettingsEmptyState>
        ) : (
          sortedSessions.map((session) => {
            const title = resolveSidebarSessionTitle(session, untitledLabel);
            const archivedAt = formatSessionDate(
              resolveTimestampMs(session.archived_at),
              i18n.language,
            );
            const workspace = resolveWorkspaceLabel(session);
            const restoring = restoringSessionId === session.id;
            return (
              <SettingsRow
                key={session.id}
                label={<span className="block truncate">{title}</span>}
                description={[
                  workspace,
                  archivedAt
                    ? t("settings.archivedConversations.meta.archivedAt", {
                        time: archivedAt,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                data-testid="settings-archived-conversation"
                data-session-id={session.id}
              >
                <SettingsAction
                  type="button"
                  disabled={restoring}
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
          })
        )}
      </SettingsGroup>
      {sortedSessions.length ? (
        <div className="flex justify-end">
          <SettingsAction
            type="button"
            onClick={() => void loadArchivedSessions()}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" />
            {t("settings.archivedConversations.action.refresh")}
          </SettingsAction>
        </div>
      ) : null}
    </SettingsPageBody>
  );
}
