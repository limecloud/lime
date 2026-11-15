import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  ProjectGitPullRequestInfo,
  ProjectGitPullRequestMerge,
  ProjectGitPullRequestMergeMethod,
} from "@/lib/api/projectGit";

export interface GitPullRequestMergeInput {
  method: ProjectGitPullRequestMergeMethod;
  deleteBranch: boolean;
}

export interface GitPullRequestMergeDialogProps {
  open: boolean;
  rootPath?: string | null;
  branch?: string | null;
  pullRequest?: ProjectGitPullRequestInfo | null;
  loading?: boolean;
  loadError?: string | null;
  pending?: boolean;
  error?: string | null;
  merged?: ProjectGitPullRequestMerge | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: GitPullRequestMergeInput) => void | Promise<void>;
}

const MERGE_METHODS: ProjectGitPullRequestMergeMethod[] = [
  "merge",
  "squash",
  "rebase",
];

export function GitPullRequestMergeDialog({
  open,
  rootPath,
  branch,
  pullRequest,
  loading = false,
  loadError,
  pending = false,
  error,
  merged,
  onOpenChange,
  onConfirm,
}: GitPullRequestMergeDialogProps) {
  const { t } = useTranslation("agent");
  const [method, setMethod] =
    useState<ProjectGitPullRequestMergeMethod>("merge");
  const [deleteBranch, setDeleteBranch] = useState(false);
  const methodId = useId();
  const deleteBranchId = useId();

  useEffect(() => {
    if (!open) return;
    setMethod("merge");
    setDeleteBranch(false);
  }, [open, rootPath]);

  const canConfirm =
    !merged &&
    !pending &&
    !loading &&
    !loadError &&
    Boolean(pullRequest);

  const requestOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-w-[480px]">
        <div data-testid="git-pull-request-merge-dialog" className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
              {String(t("agentChat.gitPullRequest.mergeTitle"))}
            </DialogTitle>
          </DialogHeader>

          {merged ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-[color:var(--lime-text-muted)]">
                {String(t("agentChat.gitPullRequest.mergeSuccessDescription"))}
              </p>
              <div
                data-testid="git-pull-request-merge-success"
                className="space-y-2 rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-3 py-2"
              >
                <p className="font-medium text-[color:var(--lime-text)]">
                  {merged.number
                    ? String(
                        t("agentChat.gitPullRequest.mergeSuccessWithNumber", {
                          number: merged.number,
                        }),
                      )
                    : String(t("agentChat.gitPullRequest.mergeSuccess"))}
                </p>
                {merged.url ? (
                  <p className="break-all font-mono text-xs text-[color:var(--lime-text-muted)]">
                    {merged.url}
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  data-testid="git-pull-request-merge-close"
                  onClick={() => requestOpenChange(false)}
                >
                  {String(t("agentChat.gitPullRequest.close"))}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 text-sm">
                <p className="text-xs text-[color:var(--lime-text-muted)]">
                  {String(t("agentChat.gitPullRequest.mergeDescription"))}
                </p>
                {rootPath ? (
                  <p
                    className="truncate rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--lime-text-muted)]"
                    title={rootPath}
                  >
                    {rootPath}
                  </p>
                ) : null}

                <div
                  data-testid="git-pull-request-merge-current"
                  className="space-y-1 rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-3 py-2"
                >
                  {loading ? (
                    <p
                      data-testid="git-pull-request-merge-loading"
                      className="flex items-center gap-1.5 text-xs text-[color:var(--lime-text-muted)]"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {String(t("agentChat.gitPullRequest.mergeLoading"))}
                    </p>
                  ) : loadError ? (
                    <p
                      role="alert"
                      data-testid="git-pull-request-merge-load-error"
                      className="text-xs text-[color:var(--lime-danger)]"
                    >
                      {loadError}
                    </p>
                  ) : pullRequest ? (
                    <>
                      <p className="font-medium text-[color:var(--lime-text)]">
                        {String(t("agentChat.gitPullRequest.mergeCurrent", {
                          number: pullRequest.number,
                        }))}
                      </p>
                      <p className="text-xs text-[color:var(--lime-text-muted)]">
                        {pullRequest.title}
                      </p>
                      <p className="font-mono text-[11px] text-[color:var(--lime-text-muted)]">
                        {pullRequest.headRefName} → {pullRequest.baseRefName}
                      </p>
                    </>
                  ) : (
                    <p
                      data-testid="git-pull-request-merge-no-pull-request"
                      className="text-xs text-[color:var(--lime-text-muted)]"
                    >
                      {String(t("agentChat.gitPullRequest.mergeNoPullRequest"))}
                    </p>
                  )}
                  <p
                    data-testid="git-pull-request-merge-branch"
                    className="font-mono text-[11px] text-[color:var(--lime-text-muted)]"
                  >
                    {String(t("agentChat.gitPullRequest.mergeBranch", {
                      branch: branch?.trim() || "—",
                    }))}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={methodId}
                    className="block text-xs font-medium text-[color:var(--lime-text)]"
                  >
                    {String(t("agentChat.gitPullRequest.mergeMethodLabel"))}
                  </label>
                  <select
                    id={methodId}
                    data-testid="git-pull-request-merge-method"
                    value={method}
                    disabled={pending || !pullRequest}
                    className="w-full rounded-md border-[0.5px] border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-2 py-1.5 text-sm text-[color:var(--lime-text)] focus-visible:outline-[color:var(--lime-accent)] disabled:opacity-50"
                    onChange={(event) =>
                      setMethod(
                        event.target.value as ProjectGitPullRequestMergeMethod,
                      )
                    }
                  >
                    {MERGE_METHODS.map((option) => (
                      <option key={option} value={option}>
                        {String(
                          t(`agentChat.gitPullRequest.mergeMethod.${option}`),
                        )}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    id={deleteBranchId}
                    data-testid="git-pull-request-merge-delete-branch"
                    checked={deleteBranch}
                    disabled={pending || !pullRequest}
                    onCheckedChange={(checked) => setDeleteBranch(checked)}
                  />
                  <div className="space-y-0.5">
                    <label
                      htmlFor={deleteBranchId}
                      className="block text-xs font-medium text-[color:var(--lime-text)]"
                    >
                      {String(
                        t(
                          "agentChat.gitPullRequest.mergeDeleteBranchLabel",
                        ),
                      )}
                    </label>
                    <p className="text-[11px] text-[color:var(--lime-text-muted)]">
                      {String(
                        t(
                          "agentChat.gitPullRequest.mergeDeleteBranchHint",
                        ),
                      )}
                    </p>
                  </div>
                </div>

                <p className="rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1.5 text-xs text-[color:var(--lime-text-muted)]">
                  {String(t("agentChat.gitPullRequest.mergeNotice"))}
                </p>

                {error ? (
                  <p
                    role="alert"
                    data-testid="git-pull-request-merge-error"
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
                  {String(t("agentChat.gitPullRequest.cancel"))}
                </Button>
                <Button
                  type="button"
                  data-testid="git-pull-request-merge-confirm"
                  disabled={!canConfirm}
                  onClick={() =>
                    void onConfirm({ method, deleteBranch })
                  }
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {String(
                    t(
                      pending
                        ? "agentChat.gitPullRequest.mergePending"
                        : "agentChat.gitPullRequest.mergeConfirm",
                    ),
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
