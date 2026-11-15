import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCommitHorizontal, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const GIT_COMMIT_MESSAGE_MAX_LENGTH = 10_000;

export interface GitCommitDialogProps {
  open: boolean;
  rootPath?: string | null;
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (message: string) => void | Promise<void>;
}

export function GitCommitDialog({
  open,
  rootPath,
  pending = false,
  error,
  onOpenChange,
  onConfirm,
}: GitCommitDialogProps) {
  const { t } = useTranslation("agent");
  const [message, setMessage] = useState("");
  const messageId = useId();
  const trimmedMessage = message.trim();
  const canConfirm = trimmedMessage.length > 0 && !pending;

  useEffect(() => {
    if (open) setMessage("");
  }, [open, rootPath]);

  const requestOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-w-[520px]">
        <div data-testid="git-commit-dialog" className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCommitHorizontal className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
              {String(t("agentChat.gitCommit.title"))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-[color:var(--lime-text-muted)]">
              {String(t("agentChat.gitCommit.description"))}
            </p>
            {rootPath ? (
              <p
                className="truncate rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--lime-text-muted)]"
                title={rootPath}
                data-testid="git-commit-root-path"
              >
                {rootPath}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <label
                htmlFor={messageId}
                className="block text-xs font-medium text-[color:var(--lime-text)]"
              >
                {String(t("agentChat.gitCommit.messageLabel"))}
              </label>
              <Textarea
                id={messageId}
                data-testid="git-commit-message"
                value={message}
                disabled={pending}
                maxLength={GIT_COMMIT_MESSAGE_MAX_LENGTH}
                rows={5}
                placeholder={String(
                  t("agentChat.gitCommit.messagePlaceholder"),
                )}
                aria-invalid={Boolean(error)}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter" &&
                    canConfirm
                  ) {
                    event.preventDefault();
                    void onConfirm(trimmedMessage);
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--lime-text-muted)]">
                <span>
                  {trimmedMessage.length > 0
                    ? null
                    : String(t("agentChat.gitCommit.messageRequired"))}
                </span>
                <span data-testid="git-commit-message-count">
                  {message.length}/{GIT_COMMIT_MESSAGE_MAX_LENGTH}
                </span>
              </div>
            </div>
            <p className="rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1.5 text-xs text-[color:var(--lime-text-muted)]">
              {String(t("agentChat.gitCommit.stageAllNotice"))}
            </p>
            {error ? (
              <p
                role="alert"
                data-testid="git-commit-error"
                className="rounded-md border border-[color:var(--lime-danger-border)] bg-[color:var(--lime-danger-soft)] px-2 py-1.5 text-xs text-[color:var(--lime-danger)]"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => requestOpenChange(false)}
            >
              {String(t("agentChat.gitCommit.cancel"))}
            </Button>
            <Button
              type="button"
              data-testid="git-commit-confirm"
              disabled={!canConfirm}
              onClick={() => void onConfirm(trimmedMessage)}
            >
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {String(
                t(
                  pending
                    ? "agentChat.gitCommit.pending"
                    : "agentChat.gitCommit.confirm",
                ),
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
