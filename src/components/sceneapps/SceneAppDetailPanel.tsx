import {
  type SceneAppDetailViewModel,
} from "@/lib/sceneapp";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SceneAppDetailPanelProps {
  detailView: SceneAppDetailViewModel | null;
  projectId: string | null;
  launchInput: string;
  planLoading: boolean;
  planError?: string | null;
  launchDisabledReason?: string;
  launching: boolean;
  onProjectChange: (projectId: string) => void;
  onLaunchInputChange: (value: string) => void;
  onLaunch: () => void;
}

export function SceneAppDetailPanel({
  detailView,
  projectId,
  launchInput,
  planLoading,
  planError,
  launchDisabledReason,
  launching,
  onProjectChange,
  onLaunchInputChange,
  onLaunch,
}: SceneAppDetailPanelProps) {
  if (!detailView) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先回到场景目录选择一个 SceneApp，再补齐启动意图和项目工作区。
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
              {detailView.businessLabel}
            </div>
            <h2
              data-testid="sceneapp-detail-title"
              className="mt-1 text-xl font-semibold text-slate-900"
            >
              {detailView.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {detailView.summary}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {detailView.typeLabel}
            </span>
            <span className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700">
              {detailView.deliveryContractLabel}
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
          <div className="text-sm font-medium text-slate-900">
            {detailView.valueStatement}
          </div>
          <div className="mt-2 grid gap-2 text-sm text-slate-500 md:grid-cols-2">
            <div>
              <span className="font-medium text-slate-700">产出：</span>
              {detailView.outputHint}
            </div>
            <div>
              <span className="font-medium text-slate-700">执行主链：</span>
              {detailView.executionChainLabel}
            </div>
            <div>
              <span className="font-medium text-slate-700">来源包：</span>
              {detailView.sourcePackageId}
            </div>
            <div>
              <span className="font-medium text-slate-700">版本：</span>
              {detailView.sourcePackageVersion}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">设计模式</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {detailView.patternLabels.map((patternLabel) => (
                <span
                  key={patternLabel}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                >
                  {patternLabel}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">启动前置</div>
            {detailView.launchRequirements.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                这个 SceneApp 没有额外前置条件，可以直接启动。
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {detailView.launchRequirements.map((message, index) => (
                  <div
                    key={`${detailView.id}-requirement-${index}`}
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                  >
                    {message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">交付合同</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.deliveryNarrative}
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <div>
                <span className="font-medium text-slate-700">主结果：</span>
                {detailView.outputHint}
              </div>
              {detailView.deliveryPrimaryPart ? (
                <div>
                  <span className="font-medium text-slate-700">默认主件：</span>
                  {detailView.deliveryPrimaryPart}
                </div>
              ) : null}
              {detailView.deliveryViewerLabel ? (
                <div>
                  <span className="font-medium text-slate-700">查看方式：</span>
                  {detailView.deliveryViewerLabel}
                </div>
              ) : null}
              {detailView.artifactProfileRef ? (
                <div data-testid="sceneapp-detail-artifact-ref">
                  <span className="font-medium text-slate-700">Artifact：</span>
                  {detailView.artifactProfileRef}
                </div>
              ) : null}
            </div>
            {detailView.deliveryRequiredParts.length ? (
              <div
                data-testid="sceneapp-detail-delivery-parts"
                className="mt-3 flex flex-wrap gap-2"
              >
                {detailView.deliveryRequiredParts.map((part) => (
                  <span
                    key={part.key}
                    className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                  >
                    {part.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前还没有显式声明必含交付部件，后续需要继续补齐。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">组合步骤</div>
            {detailView.compositionBlueprintRef ? (
              <div className="mt-3 space-y-3">
                <div
                  data-testid="sceneapp-detail-blueprint-ref"
                  className="text-sm leading-6 text-slate-600"
                >
                  <span className="font-medium text-slate-700">蓝图：</span>
                  {detailView.compositionBlueprintRef}
                </div>
                <div className="text-sm leading-6 text-slate-600">
                  <span className="font-medium text-slate-700">阶段数：</span>
                  {detailView.compositionStepCount}
                </div>
                {detailView.compositionSteps.length ? (
                  <div className="flex flex-col gap-2">
                    {detailView.compositionSteps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="text-sm font-medium text-slate-700">
                          {step.title}
                        </div>
                        {step.bindingLabel ? (
                          <div className="mt-1 text-xs text-slate-500">
                            执行面：{step.bindingLabel}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前 SceneApp 还没有显式组合蓝图，继续按单阶段 binding 运行。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">评分口径</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.scorecardNarrative}
            </p>
            {detailView.scorecardProfileRef ? (
              <div
                data-testid="sceneapp-detail-scorecard-ref"
                className="mt-3 text-sm leading-6 text-slate-600"
              >
                <span className="font-medium text-slate-700">Profile：</span>
                {detailView.scorecardProfileRef}
              </div>
            ) : null}
            {detailView.scorecardMetricKeys.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {detailView.scorecardMetricKeys.map((metric) => (
                  <span
                    key={metric.key}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                  >
                    {metric.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前 profile 还没有显式暴露指标键，后续会继续和真实评分聚合对齐。
              </p>
            )}
            {detailView.scorecardFailureSignals.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  重点关注
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detailView.scorecardFailureSignals.map((signal) => (
                    <span
                      key={signal.key}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                    >
                      {signal.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium text-slate-900">执行预规划</div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {detailView.planning.statusLabel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.planning.summary}
            </p>
            {planLoading ? (
              <p className="mt-3 text-xs font-medium text-lime-700">
                正在根据当前项目与输入刷新预规划…
              </p>
            ) : null}
            {planError ? (
              <p className="mt-3 text-sm leading-6 text-amber-700">{planError}</p>
            ) : null}
            {detailView.planning.unmetRequirements.length ? (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500">仍待补齐</div>
                <div
                  data-testid="sceneapp-detail-planning-unmet"
                  className="mt-2 flex flex-col gap-2"
                >
                  {detailView.planning.unmetRequirements.map((message, index) => (
                    <div
                      key={`${detailView.id}-planning-unmet-${index}`}
                      className="rounded-[18px] border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm leading-6 text-amber-800"
                    >
                      {message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {detailView.contextPlan ? (
              <div className="mt-4 space-y-3">
                {detailView.contextPlan.activeLayers.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">活跃层</div>
                    <div
                      data-testid="sceneapp-detail-context-layers"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.activeLayers.map((layer) => (
                        <span
                          key={layer.key}
                          className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                        >
                          {layer.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div
                  data-testid="sceneapp-detail-context-reference-count"
                  className="text-sm leading-6 text-slate-600"
                >
                  <span className="font-medium text-slate-700">参考注入：</span>
                  {detailView.contextPlan.referenceCount} 条
                </div>
                {detailView.contextPlan.memoryRefs.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">记忆引用</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detailView.contextPlan.memoryRefs.map((memoryRef) => (
                        <span
                          key={memoryRef.key}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {memoryRef.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.toolRefs.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">工具开放面</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detailView.contextPlan.toolRefs.map((toolRef) => (
                        <span
                          key={toolRef.key}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                        >
                          {toolRef.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.tasteSummary ? (
                  <div
                    data-testid="sceneapp-detail-context-taste-summary"
                    className="rounded-[18px] border border-lime-200 bg-lime-50/70 px-3 py-2 text-sm leading-6 text-lime-900"
                  >
                    <span className="font-medium">风格摘要：</span>
                    {detailView.contextPlan.tasteSummary}
                  </div>
                ) : null}
                {detailView.contextPlan.notes.length ? (
                  <div className="space-y-2">
                    {detailView.contextPlan.notes.map((note, index) => (
                      <div
                        key={`${detailView.id}-context-note-${index}`}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-500">
                当前还没有生成上下文覆盖层，继续补项目或启动输入后会自动刷新。
              </p>
            )}
            {detailView.planning.warnings.length ? (
              <div className="mt-4 space-y-2">
                {detailView.planning.warnings.map((warning, index) => (
                  <div
                    key={`${detailView.id}-planning-warning-${index}`}
                    className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">Project Pack 规划</div>
            {detailView.projectPackPlan ? (
              <>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <div>
                    <span className="font-medium text-slate-700">交付形态：</span>
                    {detailView.projectPackPlan.packKindLabel}
                  </div>
                  <div data-testid="sceneapp-detail-pack-strategy">
                    <span className="font-medium text-slate-700">完成策略：</span>
                    {detailView.projectPackPlan.completionStrategyLabel}
                  </div>
                  {detailView.projectPackPlan.primaryPart ? (
                    <div>
                      <span className="font-medium text-slate-700">主件：</span>
                      {detailView.projectPackPlan.primaryPart}
                    </div>
                  ) : null}
                  {detailView.projectPackPlan.viewerLabel ? (
                    <div>
                      <span className="font-medium text-slate-700">查看方式：</span>
                      {detailView.projectPackPlan.viewerLabel}
                    </div>
                  ) : null}
                </div>
                {detailView.projectPackPlan.requiredParts.length ? (
                  <div
                    data-testid="sceneapp-detail-pack-required-parts"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {detailView.projectPackPlan.requiredParts.map((part) => (
                      <span
                        key={part.key}
                        className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                      >
                        {part.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    当前规划还没有显式声明整包部件，继续沿现有结果回流主链执行。
                  </p>
                )}
                {detailView.projectPackPlan.notes.length ? (
                  <div className="mt-4 space-y-2">
                    {detailView.projectPackPlan.notes.map((note, index) => (
                      <div
                        key={`${detailView.id}-pack-note-${index}`}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前规划还没有显式暴露 Project Pack 结果，继续沿现有交付合同运行。
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-900">启动输入</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            这一步只负责补齐场景意图，真正执行仍继续复用 Agent 或自动化主链。
          </p>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              项目工作区
            </div>
            <ProjectSelector
              value={projectId}
              workspaceType="general"
              placeholder="选择项目工作区"
              dropdownSide="bottom"
              onChange={onProjectChange}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              启动意图
            </div>
            <Textarea
              value={launchInput}
              placeholder={detailView.launchInputPlaceholder}
              className="min-h-[128px] rounded-[20px] border-slate-200 bg-slate-50 text-sm leading-6"
              onChange={(event) => onLaunchInputChange(event.target.value)}
            />
          </div>

          <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">
              {detailView.launchSeedLabel}
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-700">
              {detailView.launchSeedPreview}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-h-[20px] text-xs text-amber-600">
              {launchDisabledReason ?? ""}
            </div>
            <Button
              type="button"
              data-testid="sceneapp-page-launch"
              className={cn(
                "rounded-full px-5",
                "bg-slate-900 text-white hover:bg-slate-800",
              )}
              disabled={Boolean(launchDisabledReason) || launching}
              onClick={onLaunch}
            >
              {launching ? "准备中…" : detailView.launchActionLabel}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
