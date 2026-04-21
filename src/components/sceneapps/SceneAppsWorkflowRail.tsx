import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SceneAppsViewMode } from "./useSceneAppsPageRuntime";

type WorkflowTone = "slate" | "sky" | "emerald" | "amber";

interface SceneAppsWorkflowRailProps {
  activeView: SceneAppsViewMode;
  hasSelectedSceneApp: boolean;
  hasRuns: boolean;
  launchReady: boolean;
  selectedSceneTitle?: string | null;
  onOpenCatalog: () => void;
  onOpenDetail: () => void;
  onOpenGovernance: () => void;
}

interface WorkflowStageViewModel {
  key: "catalog" | "detail" | "governance";
  stepLabel: string;
  title: string;
  statusLabel: string;
  summary: string;
  actionLabel: string;
  tone: WorkflowTone;
  onAction: () => void;
}

const CARD_CLASSNAMES: Record<WorkflowTone, string> = {
  slate: "border-slate-200 bg-white",
  sky: "border-sky-200 bg-sky-50/70",
  emerald: "border-emerald-200 bg-emerald-50/70",
  amber: "border-amber-200 bg-amber-50/70",
};

const STATUS_CLASSNAMES: Record<WorkflowTone, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

function buildWorkflowStages(
  props: SceneAppsWorkflowRailProps,
): WorkflowStageViewModel[] {
  const selectedSceneName = props.selectedSceneTitle?.trim();

  const catalogStage: WorkflowStageViewModel = {
    key: "catalog",
    stepLabel: "Step 1",
    title: "选场景",
    statusLabel:
      props.activeView === "catalog"
        ? "当前正在选品"
        : props.hasSelectedSceneApp
          ? "已选定场景"
          : "等待开始",
    summary:
      props.activeView === "catalog"
        ? "继续按结果目标、模式和基础设施筛选，决定这次要推进哪条 SceneApp。"
        : props.hasSelectedSceneApp
          ? selectedSceneName
            ? `当前已选「${selectedSceneName}」，如果这条场景不合适，可以随时回目录换场景。`
            : "当前已经选中一条 SceneApp，仍然可以回目录重新挑选。"
          : "先从目录挑一条要推进的 SceneApp，再进入启动和治理。",
    actionLabel: props.activeView === "catalog" ? "继续筛选" : "回到目录",
    tone:
      props.activeView === "catalog"
        ? "sky"
        : props.hasSelectedSceneApp
          ? "emerald"
          : "slate",
    onAction: props.onOpenCatalog,
  };

  const detailStage: WorkflowStageViewModel = !props.hasSelectedSceneApp
    ? {
        key: "detail",
        stepLabel: "Step 2",
        title: "补启动",
        statusLabel: "先选场景",
        summary: "先从目录确定一条 SceneApp，再补项目工作区和启动意图。",
        actionLabel: "先去目录",
        tone: "slate",
        onAction: props.onOpenCatalog,
      }
    : {
        key: "detail",
        stepLabel: "Step 2",
        title: "补启动",
        statusLabel:
          props.activeView === "detail"
            ? "当前正在补启动"
            : props.launchReady
              ? "可以启动"
              : "待补输入",
        summary:
          props.activeView === "detail"
            ? props.launchReady
              ? "项目与输入已经具备，可以直接启动，也可以继续校正结果交付约定与组合步骤。"
              : "继续补齐项目工作区或启动输入，让这套做法进入可启动状态。"
            : props.launchReady
              ? "这套做法已经具备首轮启动条件，可以直接进入详情页发起结果链。"
              : "这套做法还没补齐启动条件，先去详情页完善项目、输入或链接。",
        actionLabel:
          props.activeView === "detail" ? "继续补启动" : "进入详情",
        tone:
          props.activeView === "detail"
            ? "sky"
            : props.launchReady
              ? "emerald"
              : "amber",
        onAction: props.onOpenDetail,
      };

  const governanceStage: WorkflowStageViewModel = !props.hasSelectedSceneApp
    ? {
        key: "governance",
        stepLabel: "Step 3",
        title: "做法复盘",
        statusLabel: "先选做法",
        summary: "做法复盘只处理已经选中的做法，先回目录确定要复盘哪套做法。",
        actionLabel: "先去目录",
        tone: "slate",
        onAction: props.onOpenCatalog,
      }
    : props.hasRuns
      ? {
          key: "governance",
          stepLabel: "Step 3",
          title: "做法复盘",
          statusLabel:
            props.activeView === "governance"
              ? "当前正在复盘"
              : "已有运行样本",
          summary:
            props.activeView === "governance"
              ? "最近运行、复盘材料和放量判断都集中在这里，可以继续复盘或准备复盘动作。"
              : "这套做法已经有运行样本，可以直接进入复盘页看结果、证据和复核判断。",
          actionLabel:
            props.activeView === "governance" ? "继续复盘" : "进入复盘",
          tone: props.activeView === "governance" ? "sky" : "emerald",
          onAction: props.onOpenGovernance,
        }
      : {
          key: "governance",
          stepLabel: "Step 3",
          title: "看治理",
          statusLabel: "等待首轮样本",
          summary:
            "这套做法还没有首轮运行样本，当前不适合直接复盘，先去详情页跑出第一轮结果链。",
          actionLabel: "先去详情启动",
          tone: "amber",
          onAction: props.onOpenDetail,
        };

  return [catalogStage, detailStage, governanceStage];
}

export function SceneAppsWorkflowRail(props: SceneAppsWorkflowRailProps) {
  const stages = buildWorkflowStages(props);

  return (
    <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium tracking-[0.12em] text-slate-500">
            WORKFLOW PATH
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            按选做法、启动、复盘三步推进
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            不用自己猜下一步在哪一页。每一步都给出当前状态和下一条最短路径。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {stages.map((stage) => (
          <article
            key={stage.key}
            data-testid={`sceneapps-workflow-stage-${stage.key}`}
            className={cn(
              "rounded-[22px] border p-4 shadow-sm shadow-slate-950/5",
              CARD_CLASSNAMES[stage.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  {stage.stepLabel}
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {stage.title}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  STATUS_CLASSNAMES[stage.tone],
                )}
              >
                {stage.statusLabel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{stage.summary}</p>
            <div className="mt-4">
              <Button
                type="button"
                size="sm"
                data-testid={`sceneapps-workflow-action-${stage.key}`}
                variant={props.activeView === stage.key ? "secondary" : "outline"}
                className="rounded-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={stage.onAction}
              >
                {stage.actionLabel}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
