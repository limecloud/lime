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
    label: "全部做法",
    summary: "先挑一套这轮最想拿结果的做法。",
  },
  {
    key: "detail",
    label: "补这轮信息",
    summary: "只补这轮进入生成前最少必要信息。",
  },
  {
    key: "governance",
    label: "最近结果",
    summary: "看最近结果和判断，再决定下一步。",
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
      ? "这套做法已经接住当前上下文，这轮信息和最近结果都能直接续上。"
      : "这套做法已经接住当前上下文，先补这轮信息，再跑出第一轮结果。"
    : runtime.recentVisits.length > 0
      ? "最近看过的做法也还在这里，选一套就能继续。"
      : "先选一套能直接起手的做法，后面只围绕这轮信息和最近结果继续。";

  return (
    <div className="lime-workbench-theme-scope flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
        <section className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
          <div className="pointer-events-none absolute inset-0 bg-[image:var(--lime-card-subtle)]" />
          <div className="pointer-events-none absolute left-1/2 top-12 h-32 w-[min(760px,92%)] -translate-x-1/2 rounded-full bg-[color:var(--lime-home-glow-primary)] blur-3xl" />
          <div className="relative flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-[900px] space-y-3">
                <div className="inline-flex rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm shadow-emerald-950/5">
                  青柠一下，灵感即来
                </div>
                <div className="relative inline-block">
                  <div className="pointer-events-none absolute inset-x-[-10%] top-1/2 h-14 -translate-y-1/2 rounded-full bg-[color:var(--lime-home-glow-primary)] blur-2xl" />
                  <h1 className="relative text-3xl font-semibold tracking-tight text-slate-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.9),0_12px_26px_rgba(163,230,53,0.18)]">
                    全部做法
                  </h1>
                </div>
                <p className="max-w-[900px] text-sm leading-7 text-slate-600 md:text-base">
                  先挑一套能产出结果的做法，补这轮必要信息，再根据最近结果继续推进。
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
                      继续填写
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
                        ? "看最近结果"
                        : "先补这轮信息"}
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
                          ? "rounded-[24px] border border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] px-4 py-4 text-left shadow-sm shadow-emerald-950/10"
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
              eyebrow="这轮信息"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可继续的整套做法"
                  : "先从全部做法里选一套"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "这轮信息页只承接已经选中的整套做法。当前搜索条件下没有匹配项，先回全部做法放宽筛选，再决定进入哪套做法。"
                  : "这轮信息页会集中显示启动前确认项、结果约定、这轮带入对象和默认判断标准。先回全部做法选中一套，再继续补输入并进入生成。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "可以直接清空当前搜索和筛选，重新回到全部做法。"
                  : undefined
              }
              primaryAction={{
                label: "回到全部做法",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-empty-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回全部做法",
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
              eyebrow="最近结果"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可查看结果的整套做法"
                  : "先从全部做法里选一套"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "最近结果页只处理已经选中的整套做法。当前搜索条件下没有匹配项，先回全部做法放宽筛选，再决定看哪套做法的结果和判断。"
                  : "最近结果会集中展示最近一轮结果、证据材料和下一步判断。先回全部做法选一套，再继续查看结果。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "如果是筛选过严导致没有匹配项，可以直接清空筛选后回到全部做法。"
                  : undefined
              }
              primaryAction={{
                label: "回到全部做法",
                onClick: () => runtime.handleViewModeChange("catalog"),
                testId: "sceneapps-governance-open-catalog",
              }}
              secondaryAction={
                hasActiveCatalogFilters
                  ? {
                      label: "清空筛选并返回全部做法",
                      onClick: runtime.handleResetCatalogFilters,
                      testId: "sceneapps-governance-reset-filters",
                    }
                  : undefined
              }
            />
          ) : shouldShowGovernanceFirstRunEmpty ? (
            <SceneAppsPageEmptyState
              eyebrow="首轮结果前"
              title="这套做法还没有首轮结果"
              description="最近结果只有在至少完成一轮正式运行后，才会回流结果文件、证据和判断。当前更适合先去补这轮信息，跑出第一轮结果。"
              detail="首轮结果出来之后，再回到这里看结果记录、证据和下一步判断。"
              primaryAction={{
                label: "去补这轮信息",
                onClick: () => runtime.handleViewModeChange("detail"),
                testId: "sceneapps-governance-open-detail",
              }}
              secondaryAction={{
                label: "返回全部做法换一套",
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
