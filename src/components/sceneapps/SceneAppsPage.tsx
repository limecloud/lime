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
    label: "做法目录",
    summary: "先挑一套能直接起手的。",
  },
  {
    key: "detail",
    label: "生成准备",
    summary: "把这轮要带着走的输入补齐。",
  },
  {
    key: "governance",
    label: "做法复盘",
    summary: "回看最近结果，再决定下一步。",
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
  const carrySummary = runtime.selectedDescriptor
    ? runtime.runListItems.length > 0
      ? "这套做法已经接住当前上下文，准备和复盘都可以直接往下走。"
      : "这套做法已经接住当前上下文，先补齐这轮准备，再跑出第一轮结果。"
    : runtime.recentVisits.length > 0
      ? "最近看过的做法也还在这里，回到目录挑一套就能继续。"
      : "先在目录里挑一套能直接起手的做法，后面的准备和复盘都会围着它继续。";

  return (
    <div className="flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
        <section className="rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-[900px] space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                  全部做法
                </h1>
                <p className="text-sm leading-7 text-slate-600 md:text-base">
                  先挑一套能直接起手的做法；这轮已经带着的灵感、意图和最近结果都会一路续上。
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                  onClick={() => {
                    void runtime.refreshCatalog();
                  }}
                >
                  刷新
                </button>
              </div>
            </div>

            {runtime.catalogError ? (
              <div className="text-sm leading-6 text-amber-700">
                {runtime.catalogError}
              </div>
            ) : null}

            <div className="space-y-4 border-t border-slate-100 pt-5">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {runtime.selectedDescriptor ? (
                    <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                      这轮做法：{runtime.selectedDescriptor.title}
                    </span>
                  ) : null}
                  {hasReferenceCarry ? (
                    <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                      已带 {runtime.selectedReferenceMemoryIds.length} 条灵感
                    </span>
                  ) : null}
                  {hasLaunchInput ? (
                    <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                      已写启动意图
                    </span>
                  ) : null}
                  {!runtime.selectedDescriptor && runtime.recentVisits.length > 0 ? (
                    <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                      最近看过的做法可直接续上
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 text-sm leading-6 text-slate-800">
                  {carrySummary}
                </div>
                {runtime.selectedDescriptor?.summary ? (
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    {runtime.selectedDescriptor.summary}
                  </div>
                ) : null}
                {hasLaunchInput ? (
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    <span className="font-medium text-slate-700">
                      启动意图：
                    </span>
                    {runtime.launchInput}
                  </div>
                ) : null}
                {runtime.selectedDescriptor ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="sceneapps-open-detail"
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
                      onClick={() => runtime.handleViewModeChange("detail")}
                    >
                      继续准备
                    </button>
                    <button
                      type="button"
                      data-testid="sceneapps-open-governance"
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
                      onClick={() =>
                        runtime.runListItems.length > 0
                          ? runtime.handleViewModeChange("governance")
                          : runtime.handleViewModeChange("detail")
                      }
                    >
                      {runtime.runListItems.length > 0
                        ? "去做法复盘"
                        : "先去生成准备"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {VIEW_OPTIONS.map((option) => {
                  const active = runtime.viewMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      data-testid={`sceneapps-view-${option.key}`}
                      className={
                        active
                          ? "rounded-[24px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] px-4 py-4 text-left shadow-sm shadow-emerald-950/10"
                          : "rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition-colors hover:border-slate-300 hover:bg-white"
                      }
                      onClick={() => runtime.handleViewModeChange(option.key)}
                    >
                      <div
                        className={
                          active
                            ? "text-sm font-semibold text-slate-950"
                            : "text-sm font-semibold text-slate-800"
                        }
                      >
                        {option.label}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-slate-500">
                        {option.summary}
                      </div>
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
              eyebrow="做法准备"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入准备页的整套做法"
                  : "先从做法目录选择一套做法"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "准备页只承接已经选中的整套做法。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要进入哪套做法的生成准备页。"
                  : "生成准备页会集中显示启动前确认项、结果约定、这轮带入对象和默认判断标准。先回到做法目录选中一套做法，再继续补启动输入并进入生成。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "可以直接清空当前搜索和筛选，重新回到目录选品。"
                  : undefined
              }
              primaryAction={{
                label: "回到做法目录",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-empty-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回目录",
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
                packRuntimeLoading={runtime.runsLoading || runtime.selectedRunLoading}
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

              <SceneAppScorecardPanel
                scorecardView={runtime.scorecardView}
                packRuntimeView={runtime.latestPackResultDetailView}
                packRuntimeLoading={runtime.runsLoading || runtime.selectedRunLoading}
                packRuntimeUsesFallback={runtime.latestPackResultUsesFallback}
                loading={runtime.scorecardLoading}
                error={runtime.scorecardError}
                latestReviewFeedbackSignal={runtime.latestReviewFeedbackSignal}
                onContinueReviewFeedback={runtime.handleContinueReviewFeedback}
                onPackRuntimeArtifactAction={
                  runtime.handleOpenSelectedRunDeliveryArtifact
                }
              />
            </div>
          )
        ) : null}

        {runtime.viewMode === "governance" ? (
          hasNoCatalogSelection ? (
            <SceneAppsPageEmptyState
              eyebrow="做法复盘"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入做法复盘的整套做法"
                  : "先从做法目录选择一套做法"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "做法复盘只处理已经选中的整套做法。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要看哪套做法的运行与复盘材料。"
                  : "做法复盘会集中展示最近运行、证据材料和放量判断。先回到做法目录选一套做法，再继续查看做法复盘。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "如果是筛选过严导致没有匹配项，可以直接清空筛选后返回目录。"
                  : undefined
              }
              primaryAction={{
                label: "回到做法目录",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-governance-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回目录",
                      onClick: runtime.handleResetCatalogFilters,
                      testId: "sceneapps-governance-reset-filters",
                    }
                  : undefined
              }
            />
          ) : shouldShowGovernanceFirstRunEmpty ? (
            <SceneAppsPageEmptyState
              eyebrow="首轮复盘前"
              title="这套做法还没有首轮治理样本"
              description="做法复盘只有在至少完成一轮正式运行后，才会回流最近运行、证据材料和复核判断。当前更适合先去详情页补齐项目与启动意图，跑出第一轮结果包。"
              detail="首轮结果跑出来之后，再回到这里查看运行记录、复盘动作和放量判断。"
              primaryAction={{
                label: "回到做法准备",
                onClick: () => runtime.handleViewModeChange("detail"),
                testId: "sceneapps-governance-open-detail",
              }}
              secondaryAction={{
                label: "返回做法目录换一套",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-governance-open-catalog",
              }}
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
              <SceneAppRunList
                runs={runtime.runListItems}
                loading={runtime.runsLoading}
                error={runtime.runsError}
                selectedRunId={runtime.selectedRunId}
                onSelectRun={runtime.handleSelectRun}
              />

              <div className="flex flex-col gap-6">
                <SceneAppGovernancePanel
                  hasSelectedSceneApp={Boolean(runtime.selectedDescriptor)}
                  governanceView={runtime.governanceView}
                  loading={runtime.selectedRunLoading}
                  error={runtime.selectedRunError}
                  latestReviewFeedbackSignal={runtime.latestReviewFeedbackSignal}
                  onContinueReviewFeedback={runtime.handleContinueReviewFeedback}
                  humanReviewAvailable={runtime.canOpenSelectedRunHumanReview}
                  humanReviewLoading={runtime.reviewDecisionLoading}
                  quickReviewActions={runtime.quickReviewActions}
                  quickReviewPending={
                    runtime.reviewDecisionLoading || runtime.reviewDecisionSaving
                  }
                  onOpenHumanReview={runtime.handleOpenSelectedRunHumanReview}
                  onApplyQuickReview={runtime.handleApplySelectedRunQuickReview}
                  onGovernanceAction={runtime.handleRunSelectedGovernanceAction}
                  onGovernanceArtifactAction={
                    runtime.handleOpenSelectedRunGovernanceArtifact
                  }
                  onEntryAction={runtime.handleOpenSelectedRunEntryAction}
                />

                <SceneAppRunDetailPanel
                  hasSelectedSceneApp={Boolean(runtime.selectedDescriptor)}
                  runDetailView={runtime.selectedRunDetailView}
                  loading={runtime.selectedRunLoading}
                  error={runtime.selectedRunError}
                  latestReviewFeedbackSignal={runtime.latestReviewFeedbackSignal}
                  onContinueReviewFeedback={runtime.handleContinueReviewFeedback}
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
                    runtime.reviewDecisionLoading || runtime.reviewDecisionSaving
                  }
                  onOpenHumanReview={runtime.handleOpenSelectedRunHumanReview}
                  onApplyQuickReview={runtime.handleApplySelectedRunQuickReview}
                  onDeliveryArtifactAction={
                    runtime.handleOpenSelectedRunDeliveryArtifact
                  }
                  onGovernanceAction={runtime.handleRunSelectedGovernanceAction}
                  onGovernanceArtifactAction={
                    runtime.handleOpenSelectedRunGovernanceArtifact
                  }
                  onEntryAction={runtime.handleOpenSelectedRunEntryAction}
                />
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
