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
    label: "场景目录",
    summary: "先找一条创作场景，再决定是否进入生成准备或治理复盘。",
  },
  {
    key: "detail",
    label: "生成准备",
    summary: "集中查看交付合同、上下文基线和进入生成前的准备。",
  },
  {
    key: "governance",
    label: "治理复盘",
    summary: "专门处理最近运行、治理材料与后续放量判断。",
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

  return (
    <div className="flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
        <section className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-[860px]">
              <div className="text-[11px] font-semibold tracking-[0.12em] text-lime-700">
                CREATE SCENES
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                按创作场景组织完整结果链
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
                这里前台讲的是创作场景，不是内部 SceneApp
                名词。每条场景都会带上参考素材、风格摘要、工具能力和交付合同，帮助你先完成选路与装配，再进入生成、结果交付和复盘。
              </p>
            </div>

            <button
              type="button"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
              onClick={() => {
                void runtime.refreshCatalog();
              }}
            >
              刷新目录
            </button>
          </div>

          {runtime.catalogError ? (
            <div className="text-sm leading-6 text-amber-700">
              {runtime.catalogError}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-4">
              {VIEW_OPTIONS.map((option) => {
                const active = runtime.viewMode === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    data-testid={`sceneapps-view-${option.key}`}
                    className={
                      active
                        ? "text-sm font-semibold text-slate-950"
                        : "text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
                    }
                    onClick={() => runtime.handleViewModeChange(option.key)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-sm leading-6 text-slate-500">
              {VIEW_OPTIONS.find((option) => option.key === runtime.viewMode)
                ?.summary ?? "按分页方式浏览创作场景。"}
            </p>
            {runtime.launchInput.trim() ||
            runtime.selectedReferenceMemoryIds.length > 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm leading-6 text-emerald-900">
                {runtime.selectedReferenceMemoryIds.length > 0 ? (
                  <div>
                    <span className="font-medium">已带入灵感对象：</span>
                    {runtime.selectedReferenceMemoryIds.length} 条，后续
                    planning 会把它们编译成正式参考对象。
                  </div>
                ) : null}
                {runtime.launchInput.trim() ? (
                  <div>
                    <span className="font-medium">已带入灵感输入：</span>
                    {runtime.launchInput}
                  </div>
                ) : null}
              </div>
            ) : null}
            {runtime.selectedDescriptor ? (
              <div className="flex flex-wrap items-center gap-3 text-sm leading-6 text-slate-600">
                <span className="font-medium text-slate-900">当前场景：</span>
                <span>{runtime.selectedDescriptor.title}</span>
                <span>{runtime.selectedDescriptor.summary}</span>
                <button
                  type="button"
                  data-testid="sceneapps-open-detail"
                  className="font-medium text-slate-700 transition-colors hover:text-slate-950"
                  onClick={() => runtime.handleViewModeChange("detail")}
                >
                  查看准备
                </button>
                <button
                  type="button"
                  data-testid="sceneapps-open-governance"
                  className="font-medium text-slate-700 transition-colors hover:text-slate-950"
                  onClick={() =>
                    runtime.runListItems.length > 0
                      ? runtime.handleViewModeChange("governance")
                      : runtime.handleViewModeChange("detail")
                  }
                >
                  {runtime.runListItems.length > 0 ? "查看治理" : "进入生成"}
                </button>
              </div>
            ) : null}
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
              eyebrow="SCENE DETAIL"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入准备页的创作场景"
                  : "先从场景目录选择一条创作场景"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "准备页只承接已经选中的创作场景。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要进入哪条场景的生成准备页。"
                  : "生成准备页会集中显示启动前置、交付合同、上下文基线和经营口径。先回到场景目录选中一条创作场景，再继续补启动输入并进入生成。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "可以直接清空当前搜索和筛选，重新回到目录选品。"
                  : undefined
              }
              primaryAction={{
                label: "回到场景目录",
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
              eyebrow="SCENE GOVERNANCE"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入治理复盘的创作场景"
                  : "先从场景目录选择一条创作场景"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "治理分页只处理已经选中的创作场景。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要看哪条场景的运行与治理材料。"
                  : "治理分页会集中展示最近运行、证据材料和放量判断。先回到场景目录选一条创作场景，再继续查看治理复盘。"
              }
              detail={
                hasActiveCatalogFilters
                  ? "如果是筛选过严导致没有匹配项，可以直接清空筛选后返回目录。"
                  : undefined
              }
              primaryAction={{
                label: "回到场景目录",
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
              eyebrow="GOVERNANCE FIRST RUN"
              title="这条创作场景还没有首轮治理样本"
              description="治理分页只有在至少完成一轮正式运行后，才会回流最近运行、证据材料和复核判断。当前更适合先去详情页补齐项目与启动意图，跑出第一轮结果包。"
              detail="首轮结果跑出来之后，再回到这里查看运行记录、治理动作和放量判断。"
              primaryAction={{
                label: "回到场景详情启动",
                onClick: () => runtime.handleViewModeChange("detail"),
                testId: "sceneapps-governance-open-detail",
              }}
              secondaryAction={{
                label: "返回场景目录换场景",
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
