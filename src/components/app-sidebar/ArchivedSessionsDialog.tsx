import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestore,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listRecentThreads } from "@/lib/api/agentRuntime/sessionClient";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";

interface ArchivedSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (session: AgentSessionInfo) => void;
  onOpenSession: (session: AgentSessionInfo) => void;
}

export function ArchivedSessionsDialog({
  open,
  onOpenChange,
  onRestore,
  onOpenSession,
}: ArchivedSessionsDialogProps) {
  const { t, i18n } = useTranslation("navigation");
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    void listRecentThreads({ archived: true, limit: 50 })
      .then((page) => {
        if (!cancelled) setSessions(page.sessions);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredSessions = sessions.filter((session) =>
    (session.name?.trim() || "").toLowerCase().includes(query.trim().toLowerCase()),
  );

  const formatUpdated = (session: AgentSessionInfo) => {
    const date = new Date(
      session.updated_at < 1e12
        ? session.updated_at * 1000
        : session.updated_at,
    );
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[520px]"
        data-testid="archived-sessions-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {String(t("navigation.sidebar.conversations.archive.title"))}
          </DialogTitle>
        </DialogHeader>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-transparent px-2.5 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={String(
              t("navigation.sidebar.conversations.archive.searchPlaceholder"),
            )}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            data-testid="archived-sessions-search"
          />
        </label>
        <div className="min-h-0 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {String(t("navigation.sidebar.conversations.archive.loading"))}
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {String(t("navigation.sidebar.conversations.archive.error"))}
            </p>
          ) : sessions.length === 0 ? (
            <p
              className="py-10 text-center text-sm text-muted-foreground"
              data-testid="archived-sessions-empty"
            >
              {String(t("navigation.sidebar.conversations.archive.empty"))}
            </p>
          ) : filteredSessions.length === 0 ? (
            <p
              className="py-10 text-center text-sm text-muted-foreground"
              data-testid="archived-sessions-no-match"
            >
              {String(
                t("navigation.sidebar.conversations.archive.noMatch"),
              )}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredSessions.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                  data-testid="archived-session-row"
                  data-session-id={session.id}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[13px]"
                    onClick={() => onOpenSession(session)}
                    title={session.name?.trim() || undefined}
                  >
                    {session.name?.trim() ||
                      String(
                        t(
                          "navigation.sidebar.conversations.archive.untitled",
                        ),
                      )}
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {formatUpdated(session)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    data-testid="archived-session-restore"
                    onClick={() => {
                      onRestore(session);
                      setSessions((current) =>
                        current.filter((item) => item.id !== session.id),
                      );
                    }}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    {String(t("navigation.sidebar.conversations.archive.restore"))}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
