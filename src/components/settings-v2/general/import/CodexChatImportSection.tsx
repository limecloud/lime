import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import {
  importCodexChat,
  listCodexChats,
  readCodexChat,
  type CodexChatConversation,
} from "@/lib/api/codexChatImport";
import { recordImport } from "@/lib/importHistory";

const RECENT_IMPORT_LIMIT = 5;

interface ImportOutcome {
  alreadyImported: boolean;
  importedMessageCount: number;
}

export function CodexChatImportSection() {
  const { t } = useTranslation("settings");
  const [conversations, setConversations] = useState<
    CodexChatConversation[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCodexChats(20);
      setConversations(result.conversations);
    } catch {
      setConversations([]);
      setMessage(t("settings.import.chatsFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importConversation = useCallback(
    async (conversation: CodexChatConversation): Promise<ImportOutcome> => {
      setImportingId(conversation.id);
      try {
        const detail = await readCodexChat(conversation.sourcePath);
        const result = await importCodexChat(detail);
        setImportedIds((previous) => {
          const next = new Set(previous);
          next.add(conversation.id);
          return next;
        });
        return {
          alreadyImported: result.alreadyImported,
          importedMessageCount: result.importedMessageCount,
        };
      } finally {
        setImportingId(null);
      }
    },
    [],
  );

  const importSingle = useCallback(
    async (conversation: CodexChatConversation) => {
      setMessage(null);
      try {
        const result = await importConversation(conversation);
        const summary = t(
          result.alreadyImported
            ? "settings.import.chatsAlreadyImportedResult"
            : "settings.import.chatsImportedResult",
          { title: conversation.title },
        );
        setMessage(summary);
        if (!result.alreadyImported) {
          recordImport({ kind: "chats", summary });
        }
      } catch {
        setMessage(t("settings.import.chatsFailed"));
      }
    },
    [importConversation, t],
  );

  const importRecent = useCallback(async () => {
    const candidates = (conversations ?? [])
      .filter(
        (conversation) =>
          conversation.importable && !importedIds.has(conversation.id),
      )
      .slice(0, RECENT_IMPORT_LIMIT);
    if (candidates.length === 0) {
      setMessage(t("settings.import.chatsRecentNone"));
      return;
    }
    setMessage(null);
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const [index, conversation] of candidates.entries()) {
      setBatchProgress({ done: index, total: candidates.length });
      try {
        const result = await importConversation(conversation);
        if (result.alreadyImported) duplicates += 1;
        else imported += 1;
      } catch {
        failed += 1;
      }
    }
    setBatchProgress(null);
    const duplicatesText =
      duplicates > 0
        ? t("settings.import.chatsDuplicates", { count: duplicates })
        : "";
    const summary = t("settings.import.chatsDone", {
      count: imported,
      duplicates: duplicatesText,
    });
    setMessage(
      failed > 0 ? `${summary}. ${t("settings.import.chatsFailed")}` : summary,
    );
    if (imported > 0) {
      recordImport({ kind: "chats", summary });
    }
  }, [conversations, importConversation, importedIds, t]);

  const busy = loading || importingId !== null || batchProgress !== null;

  return (
    <SettingsSection title={t("settings.import.chatsTitle")}>
      <SettingsGroup>
        <SettingsRow
          label={t("settings.import.chatsLabel")}
          description={
            conversations
              ? t("settings.import.chatsDetected", {
                  count: conversations.length,
                })
              : t("settings.import.chatsLoading")
          }
          targetId="import-codex-chats"
        >
          <div className="flex min-w-0 flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              <SettingsAction
                type="button"
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  void refresh();
                }}
              >
                {loading
                  ? t("settings.import.running")
                  : t("settings.import.chatsRefresh")}
              </SettingsAction>
              <SettingsAction
                type="button"
                disabled={busy || (conversations?.length ?? 0) === 0}
                onClick={() => {
                  void importRecent();
                }}
              >
                {batchProgress
                  ? t("settings.import.chatsProgress", {
                      done: batchProgress.done,
                      total: batchProgress.total,
                    })
                  : t("settings.import.chatsImportRecent")}
              </SettingsAction>
            </div>
            {message ? (
              <span
                role="status"
                className="max-w-[320px] text-right text-[11px] text-muted-foreground"
              >
                {message}
              </span>
            ) : null}
          </div>
        </SettingsRow>
        {conversations === null ? null : conversations.length === 0 ? (
          <SettingsRow
            label={t("settings.import.chatsEmpty")}
            targetId="import-codex-chats-empty"
          >
            <span />
          </SettingsRow>
        ) : (
          conversations.map((conversation) => {
            const imported = importedIds.has(conversation.id);
            const importing = importingId === conversation.id;
            return (
              <SettingsRow
                key={conversation.id}
                label={conversation.title || conversation.id}
                description={[
                  t("settings.import.chatsMessageCount", {
                    count: conversation.messageCount,
                  }),
                  new Date(conversation.updatedAt).toLocaleString(),
                  conversation.importable
                    ? null
                    : t("settings.import.chatsTooLarge"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                targetId={`import-codex-chat-${conversation.id}`}
              >
                <SettingsAction
                  type="button"
                  disabled={busy || imported || !conversation.importable}
                  onClick={() => {
                    void importSingle(conversation);
                  }}
                >
                  {imported
                    ? t("settings.import.chatsImported")
                    : importing
                      ? t("settings.import.running")
                      : t("settings.import.chatsImport")}
                </SettingsAction>
              </SettingsRow>
            );
          })
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
