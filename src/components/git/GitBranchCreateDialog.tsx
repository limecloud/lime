import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GIT_BRANCH_NAME_MAX_LENGTH,
  validateGitBranchName,
} from "./gitBranchName";

export interface GitBranchCreateDialogProps {
  open: boolean;
  rootPath?: string | null;
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (branch: string) => void | Promise<void>;
}

export function GitBranchCreateDialog({
  open,
  rootPath,
  pending = false,
  error,
  onOpenChange,
  onConfirm,
}: GitBranchCreateDialogProps) {
  const { t } = useTranslation("agent");
  const [branch, setBranch] = useState("");
  const inputId = useId();
  const trimmedBranch = branch.trim();
  const validation = validateGitBranchName(branch);
  const canConfirm = validation === null && !pending;

  useEffect(() => {
    if (open) setBranch("");
  }, [open, rootPath]);

  const requestOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  const validationMessage =
    validation === "required"
      ? String(t("agentChat.gitBranchCreate.branchRequired"))
      : validation === "tooLong"
        ? String(
            t("agentChat.gitBranchCreate.branchTooLong", {
              max: GIT_BRANCH_NAME_MAX_LENGTH,
            }),
          )
        : validation === "invalid"
          ? String(t("agentChat.gitBranchCreate.branchInvalid"))
          : null;

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-w-[460px]">
        <div data-testid="git-branch-create-dialog" className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
              {String(t("agentChat.gitBranchCreate.title"))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-[color:var(--lime-text-muted)]">
              {String(t("agentChat.gitBranchCreate.description"))}
            </p>
            {rootPath ? (
              <p
                className="truncate rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--lime-text-muted)]"
                title={rootPath}
                data-testid="git-branch-create-root-path"
              >
                {rootPath}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <label
                htmlFor={inputId}
                className="block text-xs font-medium text-[color:var(--lime-text)]"
              >
                {String(t("agentChat.gitBranchCreate.branchLabel"))}
              </label>
              <Input
                id={inputId}
                data-testid="git-branch-create-name"
                value={branch}
                disabled={pending}
                autoFocus
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={String(
                  t("agentChat.gitBranchCreate.branchPlaceholder"),
                )}
                aria-invalid={validation !== null}
                onChange={(event) => setBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirm) {
                    event.preventDefault();
                    void onConfirm(trimmedBranch);
                  }
                }}
              />
              <div className="flex items-start justify-between gap-2 text-[11px] text-[color:var(--lime-text-muted)]">
                <span
                  data-testid="git-branch-create-validation"
                  className={
                    validation && validation !== "required"
                      ? "text-[color:var(--lime-danger)]"
                      : undefined
                  }
                >
                  {validationMessage}
                </span>
                <span
                  className="shrink-0"
                  data-testid="git-branch-create-name-count"
                >
                  {[...branch].length}/{GIT_BRANCH_NAME_MAX_LENGTH}
                </span>
              </div>
            </div>
            <p className="rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1.5 text-xs text-[color:var(--lime-text-muted)]">
              {String(t("agentChat.gitBranchCreate.notice"))}
            </p>
            {error ? (
              <p
                role="alert"
                data-testid="git-branch-create-error"
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
              {String(t("agentChat.gitBranchCreate.cancel"))}
            </Button>
            <Button
              type="button"
              data-testid="git-branch-create-confirm"
              disabled={!canConfirm}
              onClick={() => void onConfirm(trimmedBranch)}
            >
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {String(
                t(
                  pending
                    ? "agentChat.gitBranchCreate.pending"
                    : "agentChat.gitBranchCreate.confirm",
                ),
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
