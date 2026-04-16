import { RefreshCw } from "lucide-react";
import { AutomationJobDialog } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { Button } from "@/components/ui/button";
import type { Page, PageParams, SceneAppsPageParams } from "@/types/page";
import { SceneAppDetailPanel } from "./SceneAppDetailPanel";
import { SceneAppGovernancePanel } from "./SceneAppGovernancePanel";
import { SceneAppsRecentPanel } from "./SceneAppsRecentPanel";
import { SceneAppRunDetailPanel } from "./SceneAppRunDetailPanel";
import { SceneAppsCatalogPanel } from "./SceneAppsCatalogPanel";
import { SceneAppsPageEmptyState } from "./SceneAppsPageEmptyState";
import { SceneAppRunList } from "./SceneAppRunList";
import { SceneAppScorecardPanel } from "./SceneAppScorecardPanel";
import { SceneAppsWorkflowRail } from "./SceneAppsWorkflowRail";
import { useSceneAppsPageRuntime } from "./useSceneAppsPageRuntime";

interface SceneAppsPageProps {
  onNavigate: (page: Page, params?: PageParams) => void;
  pageParams?: SceneAppsPageParams;
}

const VIEW_OPTIONS = [
  {
    key: "catalog",
    label: "场景目录",
    summary: "先找要看的场景，再决定是否进入详情或治理。",
  },
  {
    key: "detail",
    label: "场景详情",
    summary: "集中查看交付合同、设计模式、启动前置与经营评分。",
  },
  {
    key: "governance",
    label: "治理复盘",
    summary: "专门处理运行样本、治理材料与后续放量判断。",
  },
] as const;

export function SceneAppsPage({
  onNavigate,
  pageParams,
}: SceneAppsPageProps) {
  const runtime = useSceneAppsPageRuntime({
    onNavigate,
    pageParams,
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
        <section className="rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,251,248,0.96)_100%)] p-6 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-[860px]">
              <div className="text-[11px] font-semibold tracking-[0.12em] text-lime-700">
                SCENEAPP WORKBENCH
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                在统一 Agent 基建上装配场景应用
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
                这里不是“又一堆单点工具”，而是把 Agent、技能、自动化、浏览器和结果包装配成可直接交付的
                SceneApp。目录来自基础设置包，下一个场景可以像选品一样切换，而不是每次都改主 App。
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="rounded-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => {
                void runtime.refreshCatalog();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新目录
            </Button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {runtime.workbenchStats.map((stat) => (
              <article
                key={stat.key}
                className="rounded-[24px] border border-slate-200 bg-white p-4"
              >
                <div className="text-xs font-medium text-slate-500">
                  {stat.label}
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {stat.value}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {stat.description}
                </p>
              </article>
            ))}
          </div>

          {runtime.catalogError ? (
            <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {runtime.catalogError}
            </div>
          ) : null}

          <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              {VIEW_OPTIONS.map((option) => {
                const active = runtime.viewMode === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    data-testid={`sceneapps-view-${option.key}`}
                    className={
                      active
                        ? "rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                        : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    }
                    onClick={() => runtime.handleViewModeChange(option.key)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {VIEW_OPTIONS.find((option) => option.key === runtime.viewMode)
                ?.summary ?? "按分页方式浏览 SceneApp。"}
            </p>
            {runtime.selectedDescriptor ? (
              <div className="mt-4 flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    当前场景
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {runtime.selectedDescriptor.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">
                    {runtime.selectedDescriptor.summary}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={
                      runtime.viewMode === "detail" ? "default" : "outline"
                    }
                    onClick={() => runtime.handleViewModeChange("detail")}
                  >
                    查看详情
                  </Button>
                  <Button
                    type="button"
                    variant={
                      runtime.viewMode === "governance" ? "default" : "outline"
                    }
                    onClick={() => runtime.handleViewModeChange("governance")}
                  >
                    查看治理
                  </Button>
                </div>
              </div>
            ) : null}

            <SceneAppsWorkflowRail
              activeView={runtime.viewMode}
              hasSelectedSceneApp={Boolean(runtime.selectedDescriptor)}
              hasRuns={runtime.runListItems.length > 0}
              launchReady={
                Boolean(runtime.selectedDescriptor) &&
                runtime.launchDisabledReason == null
              }
              selectedSceneTitle={runtime.selectedDescriptor?.title}
              onOpenCatalog={() => runtime.handleViewModeChange("catalog")}
              onOpenDetail={() => runtime.handleViewModeChange("detail")}
              onOpenGovernance={() =>
                runtime.runListItems.length > 0
                  ? runtime.handleViewModeChange("governance")
                  : runtime.handleViewModeChange("detail")
              }
            />
          </div>
        </section>

        {runtime.viewMode === "catalog" ? (
          <>
            <SceneAppsRecentPanel
              items={runtime.recentVisits}
              onResume={runtime.handleResumeRecentVisit}
            />

            <SceneAppsCatalogPanel
              items={runtime.catalogCards}
              searchQuery={runtime.searchQuery}
              typeFilter={runtime.typeFilter}
              patternFilter={runtime.patternFilter}
              selectedSceneAppId={runtime.selectedSceneAppId}
              onSearchQueryChange={runtime.handleSearchQueryChange}
              onTypeFilterChange={runtime.handleTypeFilterChange}
              onPatternFilterChange={runtime.handlePatternFilterChange}
              onSelectSceneApp={runtime.handleSelectSceneApp}
            />
          </>
        ) : null}

        {runtime.viewMode === "detail" ? (
          hasNoCatalogSelection ? (
            <SceneAppsPageEmptyState
              eyebrow="SCENEAPP DETAIL"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入详情的 SceneApp"
                  : "先从场景目录选择一个 SceneApp"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "详情页只承接已经选中的 SceneApp。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要进入哪条场景的启动与交付页。"
                  : "详情页会集中显示启动前置、交付合同、组合步骤和经营口径。先回到场景目录选中一条 SceneApp，再继续补启动输入。"
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
                projectId={runtime.selectedProjectId}
                launchInput={runtime.launchInput}
                launchDisabledReason={runtime.launchDisabledReason}
                launching={
                  runtime.launchingSceneAppId === runtime.selectedDescriptor?.id
                }
                onProjectChange={runtime.handleProjectChange}
                onLaunchInputChange={runtime.handleLaunchInputChange}
                onLaunch={runtime.handleLaunchSelected}
              />

              <SceneAppScorecardPanel
                scorecardView={runtime.scorecardView}
                loading={runtime.scorecardLoading}
                error={runtime.scorecardError}
              />
            </div>
          )
        ) : null}

        {runtime.viewMode === "governance" ? (
          hasNoCatalogSelection ? (
            <SceneAppsPageEmptyState
              eyebrow="SCENEAPP GOVERNANCE"
              title={
                runtime.filteredDescriptors.length === 0
                  ? "当前筛选后还没有可进入治理复盘的 SceneApp"
                  : "先从场景目录选择一个 SceneApp"
              }
              description={
                runtime.filteredDescriptors.length === 0
                  ? "治理分页只处理已经选中的 SceneApp。当前搜索条件下没有匹配项，先回目录放宽筛选，再决定要看哪条场景的运行与治理材料。"
                  : "治理分页会集中展示最近运行、证据材料和放量判断。先回到场景目录选一条 SceneApp，再继续查看治理复盘。"
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
              title="这条 SceneApp 还没有首轮治理样本"
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
    </div>
  );
}
