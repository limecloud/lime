import {
  Check,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderOpen,
  GitCompareArrows,
  ListChecks,
  Loader2,
  MoreHorizontal,
  GitBranch,
  RotateCw,
} from "lucide-react";
import type {
  CanvasWorkbenchChangeDiffStats,
  CanvasWorkbenchGitSummary,
} from "./CanvasWorkbenchChangesPanelViewModel";
import { DiffStats } from "./CanvasWorkbenchChangeStats";
import {
  CanvasWorkbenchReviewMenu,
  type CanvasWorkbenchReviewMenuModel,
} from "./CanvasWorkbenchReviewMenu";
import {
  CANVAS_WORKBENCH_REVIEW_BASE_OPTIONS,
  type CanvasWorkbenchReviewBase,
  type CanvasWorkbenchReviewCommitOption,
  type CanvasWorkbenchTranslation,
} from "./CanvasWorkbenchChangesTypes";

export interface CanvasWorkbenchChangesToolbarProps extends CanvasWorkbenchReviewMenuModel {
  translateWorkbench: CanvasWorkbenchTranslation;
  diffStats: CanvasWorkbenchChangeDiffStats;
  gitSummary?: CanvasWorkbenchGitSummary;
  changeFileCount?: number;
  checkpointCount?: number;
  reviewMenuOpen: boolean;
  baseMenuOpen: boolean;
  selectedBase: CanvasWorkbenchReviewBase;
  branchCompareLabel?: string | null;
  filesPanelOpen: boolean;
  showFilesToggle?: boolean;
  actionsDisabled?: boolean;
  baseSelectorDisabled?: boolean;
  reviewMenuDisabled?: boolean;
  diffViewToggleDisabled?: boolean;
  reviewActionBusy?: boolean;
  copyGitApplyDisabled?: boolean;
  loadFullFileDisabled?: boolean;
  commitOptions?: CanvasWorkbenchReviewCommitOption[];
  commitsLoading?: boolean;
  selectedCommitSha?: string | null;
  diffVariant: "inline" | "split";
  onToggleReviewMenu: () => void;
  onToggleBaseMenu: () => void;
  onSelectBase: (base: CanvasWorkbenchReviewBase) => void;
  onOpenCommitMenu?: () => void | Promise<void>;
  onSelectCommit?: (commit: CanvasWorkbenchReviewCommitOption) => void;
  onRefreshChanges?: () => void | Promise<void>;
  onCopyGitApply?: () => void | Promise<void>;
  onToggleDiffVariant?: () => void;
  onToggleFilesPanel?: () => void;
  onOpenFile?: () => void;
  reviewRunStatus?: "idle" | "starting" | "inProgress" | "completed" | "failed";
  reviewStatusLabelKey?: string | null;
  reviewStartDisabled?: boolean;
  onStartReview?: () => void | Promise<void>;
}

export function CanvasWorkbenchChangesToolbar({
  translateWorkbench,
  diffStats,
  gitSummary,
  changeFileCount = 0,
  checkpointCount,
  reviewMenuOpen,
  baseMenuOpen,
  selectedBase,
  branchCompareLabel,
  filesPanelOpen,
  showFilesToggle = true,
  actionsDisabled = false,
  baseSelectorDisabled,
  reviewMenuDisabled,
  diffViewToggleDisabled,
  reviewActionBusy = false,
  copyGitApplyDisabled = false,
  loadFullFileDisabled = false,
  commitOptions = [],
  commitsLoading = false,
  selectedCommitSha = null,
  collapseDiffContext,
  loadFullFile,
  textDiffEnabled,
  showWhitespace,
  diffVariant,
  onToggleReviewMenu,
  onToggleBaseMenu,
  onSelectBase,
  onOpenCommitMenu,
  onSelectCommit,
  onRefreshChanges,
  onCopyGitApply,
  onToggleCollapseContext,
  onToggleLoadFullFile,
  onToggleTextDiff,
  onToggleWhitespace,
  onToggleDiffVariant,
  onToggleFilesPanel,
  onOpenFile,
  reviewRunStatus = "idle",
  reviewStatusLabelKey,
  reviewStartDisabled = true,
  onStartReview,
}: CanvasWorkbenchChangesToolbarProps) {
  const filesPanelToggleLabel = translateWorkbench(
    filesPanelOpen
      ? "agentChat.canvasWorkbench.coding.changes.hideFiles"
      : "agentChat.canvasWorkbench.coding.changes.showFiles",
  );
  const diffViewToggleLabel = translateWorkbench(
    diffVariant === "inline"
      ? "agentChat.canvasWorkbench.coding.changes.switchToSplitDiff"
      : "agentChat.canvasWorkbench.coding.changes.switchToInlineDiff",
  );
  const selectedBaseLabel = translateWorkbench(
    CANVAS_WORKBENCH_REVIEW_BASE_OPTIONS.find(
      (option) => option.key === selectedBase,
    )?.labelKey ||
      "agentChat.canvasWorkbench.coding.changes.base.previousConversation",
  );
  const isBaseSelectorDisabled = baseSelectorDisabled ?? actionsDisabled;
  const isReviewMenuDisabled = reviewMenuDisabled ?? actionsDisabled;
  const isDiffViewToggleDisabled =
    diffViewToggleDisabled ?? (actionsDisabled || !onToggleDiffVariant);
  const toolbarButtonClassName =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-transparent bg-[color:var(--lime-surface)] text-[color:var(--lime-text-muted)] transition-colors hover:border-[color:var(--lime-surface-border)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-not-allowed disabled:text-[color:var(--lime-text-muted)]";
  const activeToolbarButtonClassName =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] text-[color:var(--lime-text-strong)] transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-not-allowed disabled:text-[color:var(--lime-text-muted)]";
  const reviewButtonLabelKey =
    reviewRunStatus === "completed" || reviewRunStatus === "failed"
      ? "agentChat.harness.codeReview.action.retry"
      : reviewStatusLabelKey || "agentChat.harness.codeReview.action.start";

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative">
          <button
            type="button"
            aria-label={translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.base.selectorAria",
            )}
            aria-haspopup="menu"
            aria-expanded={baseMenuOpen}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2.5 text-[13px] font-medium text-[color:var(--lime-text-strong)] transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)] disabled:opacity-70"
            disabled={isBaseSelectorDisabled}
            onClick={onToggleBaseMenu}
          >
            <span className="truncate">{selectedBaseLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
          </button>
          {baseMenuOpen && !isBaseSelectorDisabled ? (
            <div
              role="menu"
              data-testid="canvas-workbench-changes-base-menu"
              className="absolute left-0 top-[calc(100%+6px)] z-[80] w-[202px] rounded-[12px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 shadow-xl shadow-[color:var(--lime-shadow-color)]"
            >
              {CANVAS_WORKBENCH_REVIEW_BASE_OPTIONS.map((option) => {
                const active = option.key === selectedBase;
                const isCommit = option.key === "commit";
                const selectedCommit = commitOptions.find(
                  (commit) => commit.sha === selectedCommitSha,
                );
                return (
                  <div key={option.key} className="relative">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      data-testid={`canvas-workbench-changes-base-option-${option.key}`}
                      onClick={() => {
                        if (isCommit) {
                          void onOpenCommitMenu?.();
                        } else {
                          onSelectBase(option.key);
                        }
                      }}
                      className={
                        "flex h-8 w-full items-center justify-between gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium text-[color:var(--lime-text-strong)] transition-colors hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
                      }
                    >
                      <span className="min-w-0 truncate">
                        {translateWorkbench(option.labelKey)}
                      </span>
                      {isCommit ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
                      ) : active ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text)]" />
                      ) : null}
                    </button>
                    {isCommit ? (
                      <div
                        role="menu"
                        data-testid="canvas-workbench-changes-base-commit-submenu"
                        className="absolute left-[calc(100%+6px)] top-0 z-[90] max-h-[320px] w-[280px] overflow-y-auto rounded-[10px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 shadow-xl shadow-[color:var(--lime-shadow-color)]"
                      >
                        {commitsLoading ? (
                          <div className="px-2 py-2 text-[13px] font-medium text-[color:var(--lime-text-muted)]">
                            {translateWorkbench(
                              "agentChat.canvasWorkbench.coding.changes.base.loadingCommits",
                            )}
                          </div>
                        ) : commitOptions.length > 0 ? (
                          commitOptions.map((commit) => {
                            const commitActive =
                              commit.sha === selectedCommit?.sha;
                            return (
                              <button
                                key={commit.sha}
                                type="button"
                                role="menuitemradio"
                                aria-checked={commitActive}
                                data-testid={`canvas-workbench-changes-base-commit-option-${commit.shortSha}`}
                                onClick={() => onSelectCommit?.(commit)}
                                className="flex w-full items-start justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--lime-surface-subtle)]"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-medium text-[color:var(--lime-text-strong)]">
                                    {commit.subject ||
                                      translateWorkbench(
                                        "agentChat.canvasWorkbench.coding.changes.base.untitledCommit",
                                      )}
                                  </span>
                                  <span className="block truncate font-mono text-[11px] text-[color:var(--lime-text-muted)]">
                                    {commit.shortSha}
                                  </span>
                                </span>
                                {commitActive ? (
                                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text)]" />
                                ) : null}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-2 py-2 text-[13px] font-medium text-[color:var(--lime-text-muted)]">
                            {translateWorkbench(
                              "agentChat.canvasWorkbench.coding.changes.base.emptyCommits",
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <span
          className="inline-flex items-center gap-1 font-mono text-[13px] font-semibold"
          data-testid="canvas-workbench-changes-diff-stats"
        >
          <DiffStats stats={diffStats} />
        </span>
        {checkpointCount ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-[color:var(--lime-brand-muted)] bg-[color:var(--lime-brand-soft)] px-2 py-1 text-xs font-medium text-[color:var(--lime-brand)]"
            data-testid="canvas-workbench-changes-checkpoints"
          >
            <ListChecks className="h-3.5 w-3.5" />
            {translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.checkpointBadge",
              { count: checkpointCount },
            )}
          </span>
        ) : null}
      </div>

      {gitSummary?.currentRef ||
      gitSummary?.comparisonBaseRef ||
      gitSummary?.repositoryRoot ||
      gitSummary?.uncommittedFileCount !== undefined ||
      changeFileCount > 0 ? (
        <div
          className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--lime-surface-border)] pt-1 font-mono text-[11px] text-[color:var(--lime-text-muted)]"
          data-testid="canvas-workbench-changes-summary"
        >
          {gitSummary?.currentRef || gitSummary?.comparisonBaseRef ? (
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              data-testid="canvas-workbench-changes-branch-summary"
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
              <span>
                {translateWorkbench(
                  "agentChat.canvasWorkbench.coding.changes.summary.branch",
                )}
              </span>
              <span className="font-semibold">
                <DiffStats stats={diffStats} />
              </span>
              <span className="min-w-0 max-w-[min(32vw,280px)] truncate text-[color:var(--lime-text-strong)]">
                <span data-testid="canvas-workbench-changes-current-ref">
                  {gitSummary?.currentRef ?? ""}
                </span>
                {gitSummary?.comparisonBaseRef ? (
                  <>
                    {" → "}
                    <span data-testid="canvas-workbench-changes-comparison-base">
                      {gitSummary.comparisonBaseRef}
                    </span>
                  </>
                ) : null}
              </span>
            </span>
          ) : null}
          {changeFileCount > 0 ? (
            <span
              data-testid="canvas-workbench-changes-file-count"
              data-count={changeFileCount}
            >
              {translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.summary.files",
                {
                  count: changeFileCount,
                },
              )}
            </span>
          ) : null}
          {gitSummary && gitSummary.uncommittedFileCount !== undefined ? (
            <span
              data-testid="canvas-workbench-changes-uncommitted-count"
              data-count={gitSummary.uncommittedFileCount}
            >
              {translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.summary.uncommitted",
                { count: gitSummary.uncommittedFileCount },
              )}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={!onRefreshChanges || actionsDisabled}
          onClick={() => {
            void onRefreshChanges?.();
          }}
          data-testid="canvas-workbench-changes-refresh"
          aria-label={translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.refresh",
          )}
          title={translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.refresh",
          )}
          className={toolbarButtonClassName}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!onOpenFile || reviewActionBusy}
          onClick={onOpenFile}
          data-testid="canvas-workbench-changes-open-file"
          aria-label={translateWorkbench(
            "agentChat.fileChangesSummary.openFile",
          )}
          title={translateWorkbench("agentChat.fileChangesSummary.openFile")}
          className={toolbarButtonClassName}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        {onStartReview ? (
          <button
            type="button"
            data-testid="code-review-summary-start-review"
            aria-label={translateWorkbench(reviewButtonLabelKey)}
            title={translateWorkbench(reviewButtonLabelKey)}
            disabled={reviewStartDisabled}
            onClick={() => void onStartReview()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-[color:var(--lime-info-border)] bg-[color:var(--lime-info-soft)] px-2.5 text-[12px] font-medium text-[color:var(--lime-info)] transition-colors hover:border-[color:var(--lime-info)] hover:bg-[color:var(--lime-surface-subtle)] disabled:cursor-not-allowed disabled:border-[color:var(--lime-surface-border)] disabled:bg-[color:var(--lime-surface-subtle)] disabled:text-[color:var(--lime-text-muted)]"
          >
            {reviewRunStatus === "starting" ||
            reviewRunStatus === "inProgress" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardCheck className="h-3.5 w-3.5" />
            )}
            <span className="hidden lg:inline">
              {translateWorkbench(reviewButtonLabelKey)}
            </span>
          </button>
        ) : null}
        {reviewStatusLabelKey && reviewRunStatus !== "idle" ? (
          <span
            className="hidden rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2 py-1 text-[11px] font-medium text-[color:var(--lime-text)] xl:inline"
            data-testid="code-review-summary-review-status"
          >
            {translateWorkbench(reviewStatusLabelKey)}
          </span>
        ) : null}
        <div className="relative">
          <button
            type="button"
            aria-label={translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.more",
            )}
            title={translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.more",
            )}
            disabled={isReviewMenuDisabled}
            onClick={onToggleReviewMenu}
            className={toolbarButtonClassName}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {reviewMenuOpen && !isReviewMenuDisabled ? (
            <CanvasWorkbenchReviewMenu
              translateWorkbench={translateWorkbench}
              reviewActionBusy={reviewActionBusy}
              copyGitApplyDisabled={copyGitApplyDisabled}
              loadFullFileDisabled={loadFullFileDisabled}
              collapseDiffContext={collapseDiffContext}
              loadFullFile={loadFullFile}
              textDiffEnabled={textDiffEnabled}
              showWhitespace={showWhitespace}
              onRefreshChanges={onRefreshChanges}
              onCopyGitApply={onCopyGitApply}
              onToggleCollapseContext={onToggleCollapseContext}
              onToggleLoadFullFile={
                loadFullFileDisabled ? undefined : onToggleLoadFullFile
              }
              onToggleTextDiff={onToggleTextDiff}
              onToggleWhitespace={onToggleWhitespace}
              onRequestClose={onToggleReviewMenu}
              className="absolute right-0 z-[80] mt-2"
            />
          ) : null}
        </div>
        <button
          type="button"
          aria-label={diffViewToggleLabel}
          title={diffViewToggleLabel}
          disabled={isDiffViewToggleDisabled}
          onClick={onToggleDiffVariant}
          className={
            diffVariant === "split"
              ? activeToolbarButtonClassName
              : toolbarButtonClassName
          }
        >
          {diffVariant === "split" ? (
            <GitCompareArrows className="h-4 w-4" />
          ) : (
            <FileDiff className="h-4 w-4" />
          )}
        </button>
        {showFilesToggle ? (
          <button
            type="button"
            data-testid="canvas-workbench-changes-files-toggle"
            aria-label={filesPanelToggleLabel}
            aria-expanded={filesPanelOpen}
            title={filesPanelToggleLabel}
            disabled={!onToggleFilesPanel}
            onClick={onToggleFilesPanel}
            className={
              filesPanelOpen
                ? activeToolbarButtonClassName
                : toolbarButtonClassName
            }
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.submit",
          )}
          title={translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.submit",
          )}
          disabled={copyGitApplyDisabled || reviewActionBusy || !onCopyGitApply}
          onClick={onCopyGitApply}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-2.5 text-[12px] font-medium text-[color:var(--lime-text-strong)] transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-not-allowed disabled:text-[color:var(--lime-text-muted)]"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">
            {translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.submit",
            )}
          </span>
        </button>
      </div>
      {selectedBase === "branch" && branchCompareLabel ? (
        <div
          className="col-span-2 flex min-w-0 items-center gap-1.5 pl-1 font-mono text-[12px] text-[color:var(--lime-text-muted)]"
          data-testid="canvas-workbench-changes-branch-compare"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
          <span className="min-w-0 truncate">{branchCompareLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
