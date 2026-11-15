import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GIT_BRANCH_NAME_MAX_LENGTH,
  validateGitBranchName,
} from "./gitBranchName";

export const GIT_PULL_REQUEST_TITLE_MAX_LENGTH = 256;
export const GIT_PULL_REQUEST_BODY_MAX_BYTES = 65_536;

export interface GitPullRequestDraft {
  title: string;
  body: string;
  draft: boolean;
  base?: string;
}

export interface GitPullRequestCreated {
  url?: string | null;
  number?: number | null;
  title?: string | null;
  draft: boolean;
}

export interface GitPullRequestDialogProps {
  open: boolean;
  rootPath?: string | null;
  initialDraft?: boolean;
  pending?: boolean;
  error?: string | null;
  created?: GitPullRequestCreated | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: GitPullRequestDraft) => void | Promise<void>;
  onOpenCreated: (url: string) => void | Promise<void>;
}

function characterCount(value: string): number {
  return [...value].length;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function GitPullRequestDialog({
  open,
  rootPath,
  initialDraft = false,
  pending = false,
  error,
  created,
  onOpenChange,
  onConfirm,
  onOpenCreated,
}: GitPullRequestDialogProps) {
  const { t } = useTranslation("agent");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [base, setBase] = useState("");
  const titleId = useId();
  const bodyId = useId();
  const baseId = useId();
  const draftId = useId();

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setDraft(initialDraft);
    setBase("");
  }, [initialDraft, open, rootPath]);

  const trimmedTitle = title.trim();
  const trimmedBase = base.trim();
  const titleValidation = !trimmedTitle
    ? "required"
    : characterCount(trimmedTitle) > GIT_PULL_REQUEST_TITLE_MAX_LENGTH
      ? "tooLong"
      : hasControlCharacter(trimmedTitle)
        ? "invalid"
        : null;
  const bodyTooLong = byteLength(body) > GIT_PULL_REQUEST_BODY_MAX_BYTES;
  const baseValidation = trimmedBase
    ? validateGitBranchName(trimmedBase)
    : null;
  const canConfirm =
    !created &&
    !pending &&
    titleValidation === null &&
    !bodyTooLong &&
    baseValidation === null;

  const requestOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  const validationMessage =
    titleValidation === "required"
      ? String(t("agentChat.gitPullRequest.titleRequired"))
      : titleValidation === "tooLong"
        ? String(
            t("agentChat.gitPullRequest.titleTooLong", {
              max: GIT_PULL_REQUEST_TITLE_MAX_LENGTH,
            }),
          )
        : titleValidation === "invalid"
          ? String(t("agentChat.gitPullRequest.titleInvalid"))
          : bodyTooLong
            ? String(
                t("agentChat.gitPullRequest.bodyTooLong", {
                  max: GIT_PULL_REQUEST_BODY_MAX_BYTES,
                }),
              )
            : baseValidation
              ? String(
                  t("agentChat.gitPullRequest.baseInvalid", {
                    max: GIT_BRANCH_NAME_MAX_LENGTH,
                  }),
                )
              : null;

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-w-[560px]">
        <div data-testid="git-pull-request-dialog" className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
              {String(
                t(
                  initialDraft
                    ? "agentChat.gitPullRequest.draftTitle"
                    : "agentChat.gitPullRequest.title",
                ),
              )}
            </DialogTitle>
          </DialogHeader>

          {created ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-[color:var(--lime-text-muted)]">
                {String(
                  t(
                    created.draft
                      ? "agentChat.gitPullRequest.createdDraftDescription"
                      : "agentChat.gitPullRequest.createdDescription",
                  ),
                )}
              </p>
              <div
                data-testid="git-pull-request-created"
                className="space-y-2 rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-3 py-2"
              >
                <p className="font-medium text-[color:var(--lime-text)]">
                  {created.number
                    ? String(
                        t("agentChat.gitPullRequest.createdNumber", {
                          number: created.number,
                        }),
                      )
                    : String(t("agentChat.gitPullRequest.created"))}
                </p>
                {created.title ? (
                  <p className="text-xs text-[color:var(--lime-text-muted)]">
                    {created.title}
                  </p>
                ) : null}
                {created.url ? (
                  <p
                    data-testid="git-pull-request-created-url"
                    className="break-all font-mono text-xs text-[color:var(--lime-text-muted)]"
                  >
                    {created.url}
                  </p>
                ) : (
                  <p className="text-xs text-[color:var(--lime-text-muted)]">
                    {String(t("agentChat.gitPullRequest.urlUnavailable"))}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                {created.url ? (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="git-pull-request-open"
                    onClick={() => void onOpenCreated(created.url as string)}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    {String(t("agentChat.gitPullRequest.openInBrowser"))}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  data-testid="git-pull-request-close"
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
                  {String(t("agentChat.gitPullRequest.description"))}
                </p>
                {rootPath ? (
                  <p
                    className="truncate rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--lime-text-muted)]"
                    title={rootPath}
                    data-testid="git-pull-request-root-path"
                  >
                    {rootPath}
                  </p>
                ) : null}

                <div className="space-y-1.5">
                  <label
                    htmlFor={titleId}
                    className="block text-xs font-medium text-[color:var(--lime-text)]"
                  >
                    {String(t("agentChat.gitPullRequest.titleLabel"))}
                  </label>
                  <Input
                    id={titleId}
                    data-testid="git-pull-request-title"
                    value={title}
                    disabled={pending}
                    autoFocus
                    placeholder={String(
                      t("agentChat.gitPullRequest.titlePlaceholder"),
                    )}
                    aria-invalid={titleValidation !== null}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--lime-text-muted)]">
                    <span>
                      {titleValidation === "required"
                        ? String(t("agentChat.gitPullRequest.titleRequired"))
                        : null}
                    </span>
                    <span data-testid="git-pull-request-title-count">
                      {characterCount(title)}/{GIT_PULL_REQUEST_TITLE_MAX_LENGTH}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={bodyId}
                    className="block text-xs font-medium text-[color:var(--lime-text)]"
                  >
                    {String(t("agentChat.gitPullRequest.bodyLabel"))}
                  </label>
                  <Textarea
                    id={bodyId}
                    data-testid="git-pull-request-body"
                    value={body}
                    disabled={pending}
                    rows={7}
                    placeholder={String(
                      t("agentChat.gitPullRequest.bodyPlaceholder"),
                    )}
                    aria-invalid={bodyTooLong}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <div className="flex justify-end text-[11px] text-[color:var(--lime-text-muted)]">
                    <span data-testid="git-pull-request-body-count">
                      {byteLength(body)}/{GIT_PULL_REQUEST_BODY_MAX_BYTES}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={baseId}
                      className="block text-xs font-medium text-[color:var(--lime-text)]"
                    >
                      {String(t("agentChat.gitPullRequest.baseLabel"))}
                    </label>
                    <Input
                      id={baseId}
                      data-testid="git-pull-request-base"
                      value={base}
                      disabled={pending}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      placeholder={String(
                        t("agentChat.gitPullRequest.basePlaceholder"),
                      )}
                      aria-invalid={baseValidation !== null}
                      onChange={(event) => setBase(event.target.value)}
                    />
                  </div>
                  <div className="flex items-start gap-2 pt-5">
                    <Checkbox
                      id={draftId}
                      data-testid="git-pull-request-draft"
                      checked={draft}
                      disabled={pending}
                      onCheckedChange={(checked) => setDraft(checked)}
                    />
                    <div className="space-y-0.5">
                      <label
                        htmlFor={draftId}
                        className="block text-xs font-medium text-[color:var(--lime-text)]"
                      >
                        {String(t("agentChat.gitPullRequest.draftLabel"))}
                      </label>
                      <p className="text-[11px] text-[color:var(--lime-text-muted)]">
                        {String(t("agentChat.gitPullRequest.draftHint"))}
                      </p>
                    </div>
                  </div>
                </div>

                <p className="rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1.5 text-xs text-[color:var(--lime-text-muted)]">
                  {String(t("agentChat.gitPullRequest.notice"))}
                </p>

                {validationMessage ? (
                  <p
                    data-testid="git-pull-request-validation"
                    className="text-xs text-[color:var(--lime-danger)]"
                  >
                    {validationMessage}
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    data-testid="git-pull-request-error"
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
                  data-testid="git-pull-request-confirm"
                  disabled={!canConfirm}
                  onClick={() =>
                    void onConfirm({
                      title: trimmedTitle,
                      body,
                      draft,
                      ...(trimmedBase ? { base: trimmedBase } : {}),
                    })
                  }
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {String(
                    t(
                      pending
                        ? "agentChat.gitPullRequest.pending"
                        : draft
                          ? "agentChat.gitPullRequest.confirmDraft"
                          : "agentChat.gitPullRequest.confirm",
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
