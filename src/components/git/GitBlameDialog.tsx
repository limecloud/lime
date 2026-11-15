import { useTranslation } from "react-i18next";
import { FileSearch, GitBranch, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProjectGitBlameLine } from "@/lib/api/projectGit";

export interface GitBlameDialogProps {
  open: boolean;
  rootPath?: string | null;
  path?: string | null;
  lines?: readonly ProjectGitBlameLine[];
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
}

export function GitBlameDialog({
  open,
  rootPath,
  path,
  lines = [],
  pending = false,
  error,
  onOpenChange,
  onRetry,
}: GitBlameDialogProps) {
  const { t } = useTranslation("agent");
  const showEmpty = !pending && !error && lines.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] p-0">
        <div data-testid="git-blame-dialog" className="flex min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b border-[color:var(--lime-surface-border)] px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
              {String(t("agentChat.gitBlame.title"))}
            </DialogTitle>
            <p className="text-xs text-[color:var(--lime-text-muted)]">
              {String(t("agentChat.gitBlame.description"))}
            </p>
            {path ? (
              <p
                data-testid="git-blame-path"
                className="truncate rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--lime-text-muted)]"
                title={rootPath ? `${rootPath}/${path}` : path}
              >
                {path}
              </p>
            ) : null}
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto">
            {pending ? (
              <div
                data-testid="git-blame-loading"
                aria-live="polite"
                className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-[color:var(--lime-text-muted)]"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {String(t("agentChat.gitBlame.loading"))}
              </div>
            ) : error ? (
              <div
                role="alert"
                data-testid="git-blame-error"
                className="m-5 rounded-md border border-[color:var(--lime-danger-border)] bg-[color:var(--lime-danger-soft)] px-3 py-2 text-sm text-[color:var(--lime-danger)]"
              >
                <p className="whitespace-pre-wrap break-words">{error}</p>
                {onRetry ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="git-blame-retry"
                    className="mt-2"
                    onClick={onRetry}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {String(t("agentChat.gitBlame.retry"))}
                  </Button>
                ) : null}
              </div>
            ) : showEmpty ? (
              <div
                data-testid="git-blame-empty"
                className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"
              >
                <FileSearch className="h-6 w-6 text-[color:var(--lime-text-muted)]" />
                <p className="text-sm text-[color:var(--lime-text-muted)]">
                  {String(t("agentChat.gitBlame.empty"))}
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[color:var(--lime-surface-subtle)] text-[11px] uppercase tracking-wide text-[color:var(--lime-text-muted)]">
                  <tr>
                    <th scope="col" className="w-14 px-3 py-2 font-medium">
                      {String(t("agentChat.gitBlame.columns.line"))}
                    </th>
                    <th scope="col" className="w-40 px-3 py-2 font-medium">
                      {String(t("agentChat.gitBlame.columns.author"))}
                    </th>
                    <th scope="col" className="w-56 px-3 py-2 font-medium">
                      {String(t("agentChat.gitBlame.columns.commit"))}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {String(t("agentChat.gitBlame.columns.content"))}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.lineNumber}
                      data-testid="git-blame-line"
                      className="border-t border-[color:var(--lime-surface-border)] align-top"
                    >
                      <td className="px-3 py-1.5 font-mono text-[color:var(--lime-text-muted)]">
                        {line.lineNumber}
                      </td>
                      <td
                        className="truncate px-3 py-1.5"
                        title={line.authorTime || line.author}
                      >
                        {line.author || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div
                          className="truncate font-mono text-[color:var(--lime-text-muted)]"
                          title={line.sha}
                        >
                          {line.shortSha || line.sha}
                        </div>
                        <div
                          data-testid="git-blame-summary"
                          className="truncate text-[color:var(--lime-text)]"
                          title={line.summary}
                        >
                          {line.summary}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <code
                          data-testid="git-blame-content"
                          className="block max-w-[360px] truncate whitespace-pre font-mono text-[color:var(--lime-text-muted)]"
                          title={line.content}
                        >
                          {line.content || " "}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex shrink-0 justify-end border-t border-[color:var(--lime-surface-border)] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {String(t("agentChat.gitBlame.close"))}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
