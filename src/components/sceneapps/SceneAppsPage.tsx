import { useEffect, useState } from "react";
import { AutomationJobDialog } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { RuntimeReviewDecisionDialog } from "@/components/agent/chat/components/RuntimeReviewDecisionDialog";
import type { Page, PageParams, SceneAppsPageParams } from "@/types/page";
import { SceneAppDetailPanel } from "./SceneAppDetailPanel";
import { SceneAppGovernancePanel } from "./SceneAppGovernancePanel";
import { SceneAppRunDetailPanel } from "./SceneAppRunDetailPanel";
import { SceneAppsCatalogPanel } from "./SceneAppsCatalogPanel";
import { SceneAppsPageEmptyState } from "./SceneAppsPageEmptyState";
import { SceneAppRunList } from "./SceneAppRunList";
import { SceneAppScorecardPanel } from "./SceneAppScorecardPanel";
import { useSceneAppsPageRuntime } from "./useSceneAppsPageRuntime";

interface SceneAppsPageProps {
  onNavigate: (page: Page, params?: PageParams) => void;
  pageParams?: SceneAppsPageParams;
  isActive?: boolean;
  isNavigationTargetOwner?: boolean;
  navigationRequestId?: number;
}

const VIEW_OPTIONS = [
  {
    key: "catalog",
    label: "选 Skill",
    summary: "先挑一个这轮最想拿结果的 Skill。",
  },
  {
    key: "detail",
    label: "准备",
    summary: "只补这轮进入生成前最少必要信息。",
  },
  {
    key: "governance",
    label: "结果",
    summary: "看最近结果和判断，再决定下一步。",
  },
] as const;

const GOVERNANCE_PANEL_OPTIONS = [
  {
    key: "governance",
    label: "结果判断",
    emptySummary: "先看这一轮值不值得继续。",
  },
  {
    key: "runDetail",
    label: "这轮结果",
    emptySummary: "看交付、证据和继续入口。",
  },
] as const;

export function SceneAppsPage({
  onNavigate,
  pageParams,
  isActive = true,
  isNavigationTargetOwner = isActive,
  navigationRequestId = 0,
}: SceneAppsPageProps) {
  const runtime = useSceneAppsPageRuntime({
    onNavigate,
    pageParams,
    isActive,
    isNavigationTargetOwner,
    navigationRequestId,
  });
  const [governancePanelMode, setGovernancePanelMode] = useState<
    (typeof GOVERNANCE_PANEL_OPTIONS)[number]["key"]
  >("governance");
  const hasActiveCatalogFilters =
    runtime.searchQuery.trim().length > 0 ||
    runtime.typeFilter !== "all" ||
    runtime.patternFilter !== "all";
  const hasNoCatalogSelection =
    !runtime.catalogLoading && !runtime.selectedDescriptor;
  const shouldShowGovernanceFirstRunEmpty =
    runtime.viewMode === "governance" &&
    Boolean(runtime.selectedDescriptor) &&
    !runtime.runsLoading &&
    !runtime.runsError &&
    runtime.runListItems.length === 0;
  const hasLaunchInput = runtime.launchInput.trim().length > 0;
  const hasReferenceCarry = runtime.selectedReferenceMemoryIds.length > 0;
  const activeViewOption = VIEW_OPTIONS.find(
    (option) => option.key === runtime.viewMode,
  )!;
  const activeGovernancePanelOption = GOVERNANCE_PANEL_OPTIONS.find(
    (option) => option.key === governancePanelMode,
  )!;
  const activeViewTitle = activeViewOption.label;
  const workflowShortcut = runtime.selectedDescriptor
    ? runtime.viewMode === "governance"
      ? {
          label: "去准备",
          onClick: () => runtime.handleViewModeChange("detail"),
        }
      : runtime.runListItems.length > 0
        ? {
            label: "看结果",
            onClick: () => runtime.handleViewModeChange("governance"),
          }
        : runtime.viewMode === "catalog"
          ? {
              label: "去准备",
              onClick: () => runtime.handleViewModeChange("detail"),
            }
          : null
    : null;
  const headerStatusItems = [
    runtime.selectedDescriptor
      ? {
          key: "selected-sceneapp",
          label: `当前：${runtime.selectedDescriptor.title}`,
        }
      : runtime.recentVisits.length > 0
        ? {
            key: "recent-visits",
            label: "可从最近继续",
          }
        : {
            key: "unselected",
            label: "先选一个 Skill",
          },
    runtime.selectedDescriptor
      ? {
          key: "run-count",
          label:
            runtime.runListItems.length > 0
              ? `${runtime.runListItems.length} 条结果`
              : "待首轮运行",
        }
      : null,
    hasReferenceCarry
      ? {
          key: "reference-carry",
          label: `已带 ${runtime.selectedReferenceMemoryIds.length} 条灵感`,
        }
      : null,
    hasLaunchInput
      ? {
          key: "launch-input",
          label: "目标已写",
          accent: true,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    accent?: boolean;
  }>;

  useEffect(() => {
    if (runtime.viewMode === "governance") {
      setGovernancePanelMode("governance");
    }
  }, [runtime.selectedSceneAppId, runtime.viewMode]);

  return (
    <div className="lime-workbench-theme-scope flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
        <section className="rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold text-slate-900">
                    {activeViewTitle}
                  </h1>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {headerStatusItems.map((item) => (
                    <span
                      key={item.key}
                      className={
                        item.accent
                          ? "max-w-[520px] truncate rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-xs font-medium text-lime-900"
                          : "max-w-[320px] truncate rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                      }
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {workflowShortcut ? (
                  <button
                    type="button"
                    data-testid="sceneapps-open-governance"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
                    onClick={workflowShortcut.onClick}
                  >
                    {workflowShortcut.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                  onClick={() => {
                    void runtime.refreshCatalog();
                  }}
                >
                  刷新
                </button>
              </div>
            </div>

            {runtime.catalogError ? (
              <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-700">
                {runtime.catalogError}
              </div>
            ) : null}

            <div className="border-t border-slate-100 pt-3">
              <div className="inline-flex flex-wrap gap-2 rounded-[20px] border border-slate-200 bg-slate-50 p-1.5">
                {VIEW_OPTIONS.map((option) => {
                  const active = runtime.viewMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={active}
                      data-testid={`sceneapps-view-${option.key}`}
                      title={option.summary}
                      className={
                        active
                          ? "inline-flex items-center rounded-[16px] border border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm shadow-emerald-950/10"
                          : "inline-flex items-center rounded-[16px] border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-900"
                      }
                      onClick={() => runtime.handleViewModeChange(option.key)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {runtime.viewMode === "catalog" ? (
          <SceneAppsCatalogPanel
            items={runtime.catalogCards}
            recentItems={runtime.recentVisits}
            runtimeLoading={runtime.catalogRuntimeLoading}
            runtimeError={runtime.catalogRuntimeError}
            searchQuery={runtime.searchQuery}
            typeFilter={runtime.typeFilter}
            patternFilter={runtime.patternFilter}
            selectedSceneAppId={runtime.selectedSceneAppId}
            onSearchQueryChange={runtime.handleSearchQueryChange}
            onTypeFilterChange={runtime.handleTypeFilterChange}
            onPatternFilterChange={runtime.handlePatternFilterChange}
            onResumeRecentVisit={runtime.handleResumeRecentVisit}
            onSelectSceneApp={runtime.handleSelectSceneApp}
          />
        ) : null}

        {runtime.viewMode === "detail" ? (
          hasNoCatalogSelection ? (
            <SceneAppsPageEmptyState
              eyebrow="这轮信息"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可继续的 Skill"
                  : "先从全部 Skills 里选一个"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "这轮信息页只承接已经选中的 Skill。当前搜索条件下没有匹配项，先回全部 Skills 放宽筛选，再决定进入哪个 Skill。"
                  : "这轮信息页会集中显示启动前确认项、结果约定、这轮带入对象和默认判断标准。先回全部 Skills 选中一个，再继续补输入并进入生成。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "可以直接清空当前搜索和筛选，重新回到全部 Skills。"
                  : undefined
              }
              primaryAction={{
                label: "回到全部 Skills",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-empty-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回全部 Skills",
                      onClick: runtime.handleResetCatalogFilters,
                      testId: "sceneapps-empty-reset-filters",
                    }
                  : undefined
              }
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)]">
              <SceneAppDetailPanel
                detailView={runtime.selectedDetailView}
                packRuntimeView={runtime.latestPackResultDetailView}
                packRuntimeLoading={
                  runtime.runsLoading || runtime.selectedRunLoading
                }
                packRuntimeUsesFallback={runtime.latestPackResultUsesFallback}
                projectId={runtime.selectedProjectId}
                launchInput={runtime.launchInput}
                planLoading={runtime.selectedPlanLoading}
                planError={runtime.selectedPlanError}
                saveBaselineDisabledReason={
                  runtime.saveContextBaselineDisabledReason
                }
                launchDisabledReason={runtime.launchDisabledReason}
                savingContextBaseline={runtime.savingContextBaseline}
                launching={
                  runtime.launchingSceneAppId === runtime.selectedDescriptor?.id
                }
                onProjectChange={runtime.handleProjectChange}
                onLaunchInputChange={runtime.handleLaunchInputChange}
                onPackRuntimeArtifactAction={
                  runtime.handleOpenSelectedRunDeliveryArtifact
                }
                onSaveContextBaseline={runtime.handleSaveContextBaseline}
                onLaunch={runtime.handleLaunchSelected}
              />

              <div className="self-start xl:sticky xl:top-6">
                <SceneAppScorecardPanel
                  scorecardView={runtime.scorecardView}
                  packRuntimeView={runtime.latestPackResultDetailView}
                  packRuntimeLoading={
                    runtime.runsLoading || runtime.selectedRunLoading
                  }
                  packRuntimeUsesFallback={runtime.latestPackResultUsesFallback}
                  loading={runtime.scorecardLoading}
                  error={runtime.scorecardError}
                  latestReviewFeedbackSignal={runtime.latestReviewFeedbackSignal}
                  onContinueReviewFeedback={
                    runtime.handleContinueReviewFeedback
                  }
                  onPackRuntimeArtifactAction={
                    runtime.handleOpenSelectedRunDeliveryArtifact
                  }
                />
              </div>
            </div>
          )
        ) : null}

        {runtime.viewMode === "governance" ? (
          hasNoCatalogSelection ? (
            <SceneAppsPageEmptyState
              eyebrow="最近结果"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可查看结果的 Skill"
                  : "先从全部 Skills 里选一个"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "最近结果页只处理已经选中的 Skill。当前搜索条件下没有匹配项，先回全部 Skills 放宽筛选，再决定看哪个 Skill 的结果和判断。"
                  : "最近结果会集中展示最近一轮结果、证据材料和下一步判断。先回全部 Skills 选一个，再继续查看结果。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "如果是筛选过严导致没有匹配项，可以直接清空筛选后回到全部 Skills。"
                  : undefined
              }
              primaryAction={{
                label: "回到全部 Skills",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-governance-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回全部 Skills",
                      onClick: runtime.handleResetCatalogFilters,
                      testId: "sceneapps-governance-reset-filters",
                    }
                  : undefined
              }
            />
          ) : shouldShowGovernanceFirstRunEmpty ? (
            <SceneAppsPageEmptyState
              eyebrow="首轮结果前"
              title="这个 Skill 还没有首轮结果"
              description="最近结果只有在至少完成一轮正式运行后，才会回流结果文件、证据和判断。当前更适合先去补这轮信息，跑出第一轮结果。"
              detail="首轮结果出来之后，再回到这里看结果记录、证据和下一步判断。"
              primaryAction={{
                label: "去补这轮信息",
                onClick: () => runtime.handleViewModeChange("detail"),
                testId: "sceneapps-governance-open-detail",
              }}
              secondaryAction={{
                label: "返回全部 Skills 换一个",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-governance-open-catalog",
              }}
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.74fr)_minmax(0,1.26fr)]">
              <div className="self-start xl:sticky xl:top-6">
                <SceneAppRunList
                  runs={runtime.runListItems}
                  loading={runtime.runsLoading}
                  error={runtime.runsError}
                  selectedRunId={runtime.selectedRunId}
                  onSelectRun={runtime.handleSelectRun}
                />
              </div>

              <div className="flex flex-col gap-6">
                <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-500">
                        右侧内容
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span className="font-medium text-slate-900">
                          {activeGovernancePanelOption.label}
                        </span>
                        {governancePanelMode === "governance" &&
                        runtime.governanceView?.statusLabel ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                            {runtime.governanceView.statusLabel}
                          </span>
                        ) : null}
                        {governancePanelMode === "runDetail" &&
                        runtime.selectedRunDetailView?.deliveryCompletionLabel ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                            {
                              runtime.selectedRunDetailView
                                .deliveryCompletionLabel
                            }
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate text-slate-500">
                          {governancePanelMode === "governance"
                            ? runtime.governanceView?.nextAction ??
                              activeGovernancePanelOption.emptySummary
                            : runtime.selectedRunDetailView?.nextAction ??
                              activeGovernancePanelOption.emptySummary}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {GOVERNANCE_PANEL_OPTIONS.map((option) => {
                        const active = governancePanelMode === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            data-testid={`sceneapps-governance-panel-${option.key}`}
                            className={
                              active
                                ? "inline-flex items-center rounded-full border border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm shadow-emerald-950/10"
                                : "inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                            }
                            onClick={() => setGovernancePanelMode(option.key)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {governancePanelMode === "governance" ? (
                  <SceneAppGovernancePanel
                    hasSelectedSceneApp={Boolean(runtime.selectedDescriptor)}
                    governanceView={runtime.governanceView}
                    loading={runtime.selectedRunLoading}
                    error={runtime.selectedRunError}
                    latestReviewFeedbackSignal={
                      runtime.latestReviewFeedbackSignal
                    }
                    onContinueReviewFeedback={
                      runtime.handleContinueReviewFeedback
                    }
                    humanReviewAvailable={runtime.canOpenSelectedRunHumanReview}
                    humanReviewLoading={runtime.reviewDecisionLoading}
                    quickReviewActions={runtime.quickReviewActions}
                    quickReviewPending={
                      runtime.reviewDecisionLoading ||
                      runtime.reviewDecisionSaving
                    }
                    onOpenHumanReview={runtime.handleOpenSelectedRunHumanReview}
                    onApplyQuickReview={
                      runtime.handleApplySelectedRunQuickReview
                    }
                    onGovernanceAction={
                      runtime.handleRunSelectedGovernanceAction
                    }
                    onGovernanceArtifactAction={
                      runtime.handleOpenSelectedRunGovernanceArtifact
                    }
                    onEntryAction={runtime.handleOpenSelectedRunEntryAction}
                  />
                ) : (
                  <SceneAppRunDetailPanel
                    hasSelectedSceneApp={Boolean(runtime.selectedDescriptor)}
                    runDetailView={runtime.selectedRunDetailView}
                    loading={runtime.selectedRunLoading}
                    error={runtime.selectedRunError}
                    latestReviewFeedbackSignal={
                      runtime.latestReviewFeedbackSignal
                    }
                    onContinueReviewFeedback={
                      runtime.handleContinueReviewFeedback
                    }
                    savedAsInspiration={runtime.selectedRunSavedAsInspiration}
                    onSaveAsInspiration={
                      runtime.handleSaveSelectedRunAsInspiration
                    }
                    onOpenInspirationLibrary={
                      runtime.handleOpenInspirationLibrary
                    }
                    humanReviewAvailable={runtime.canOpenSelectedRunHumanReview}
                    humanReviewLoading={runtime.reviewDecisionLoading}
                    quickReviewActions={runtime.quickReviewActions}
                    quickReviewPending={
                      runtime.reviewDecisionLoading ||
                      runtime.reviewDecisionSaving
                    }
                    onOpenHumanReview={runtime.handleOpenSelectedRunHumanReview}
                    onApplyQuickReview={
                      runtime.handleApplySelectedRunQuickReview
                    }
                    onDeliveryArtifactAction={
                      runtime.handleOpenSelectedRunDeliveryArtifact
                    }
                    onGovernanceAction={
                      runtime.handleRunSelectedGovernanceAction
                    }
                    onGovernanceArtifactAction={
                      runtime.handleOpenSelectedRunGovernanceArtifact
                    }
                    onEntryAction={runtime.handleOpenSelectedRunEntryAction}
                  />
                )}
              </div>
            </div>
          )
        ) : null}
      </div>

      <AutomationJobDialog
        open={runtime.automationDialogOpen}
        mode="create"
        workspaces={runtime.automationWorkspaces}
        initialValues={runtime.automationDialogInitialValues}
        saving={runtime.automationJobSaving}
        onOpenChange={runtime.handleAutomationDialogOpenChange}
        onSubmit={runtime.handleAutomationDialogSubmit}
      />

      <RuntimeReviewDecisionDialog
        open={runtime.reviewDecisionDialogOpen}
        template={runtime.reviewDecisionTemplate}
        saving={runtime.reviewDecisionSaving}
        onOpenChange={runtime.setReviewDecisionDialogOpen}
        onSave={runtime.handleSaveSelectedRunHumanReview}
      />
    </div>
  );
}
