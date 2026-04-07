import { Clock3, FolderOpen, Sparkles, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type GeneralWorkbenchHarnessRunState =
  | "idle"
  | "auto_running"
  | "await_user_decision";

interface GeneralWorkbenchHarnessCardProps {
  runState: GeneralWorkbenchHarnessRunState;
  stageTitle: string;
  stageDescription: string;
  runTitle?: string | null;
  artifactCount: number;
  updatedAt?: string | null;
  pendingCount?: number;
  harnessPanelVisible: boolean;
  layout?: "card" | "compact" | "sidebar" | "icon";
  onToggleHarnessPanel: () => void;
}

function formatUpdatedAt(value?: string | null): string {
  if (!value) {
    return "等待首次执行";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "等待首次执行";
  }

  return parsed.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveRunStateMeta(runState: GeneralWorkbenchHarnessRunState): {
  label: string;
  variant: "secondary" | "default" | "destructive";
  description: string;
} {
  switch (runState) {
    case "auto_running":
      return {
        label: "执行中",
        variant: "default",
        description: "工作台编排正在推进，可随时打开 Harness 查看细节。",
      };
    case "await_user_decision":
      return {
        label: "待决策",
        variant: "destructive",
        description: "当前卡在人工闸门，等待你的确认后继续。",
      };
    default:
      return {
        label: "待机",
        variant: "secondary",
        description: "当前没有活跃执行，但 Harness 入口会常驻显示。",
      };
  }
}

export function GeneralWorkbenchHarnessCard({
  runState,
  stageTitle,
  stageDescription,
  runTitle,
  artifactCount,
  updatedAt,
  pendingCount = 0,
  harnessPanelVisible,
  layout = "card",
  onToggleHarnessPanel,
}: GeneralWorkbenchHarnessCardProps) {
  const runStateMeta = resolveRunStateMeta(runState);
  const resolvedRunTitle = runTitle?.trim() || "暂无运行记录";
  const artifactSummary =
    artifactCount > 0 ? `${artifactCount} 个产物` : "暂无产物";
  const updatedAtLabel = formatUpdatedAt(updatedAt);
  const iconLabel = [
    "工作台 Harness",
    runStateMeta.label,
    stageTitle,
    resolvedRunTitle,
    artifactSummary,
    pendingCount > 0 ? `待处理 ${pendingCount}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  if (layout === "icon") {
    return (
      <div
        data-testid="theme-workbench-harness-card"
        data-run-state={runState}
        data-layout="icon"
      >
        <Button
          type="button"
          size="sm"
          variant={harnessPanelVisible ? "secondary" : "ghost"}
          data-testid="theme-workbench-harness-toggle"
          aria-label={iconLabel}
          title={iconLabel}
          onClick={onToggleHarnessPanel}
          className="relative h-8 w-8 rounded-full border border-border/60 bg-background/90 p-0 shadow-none"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="sr-only">{iconLabel}</span>
          {pendingCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          ) : runState !== "idle" ? (
            <span
              className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background ${
                runState === "await_user_decision"
                  ? "bg-destructive"
                  : "bg-primary"
              }`}
            />
          ) : null}
        </Button>
      </div>
    );
  }

  if (layout === "compact") {
    return (
      <div
        data-testid="theme-workbench-harness-card"
        data-run-state={runState}
        data-layout="compact"
        className="mx-4 mb-2 rounded-2xl border border-border/70 bg-card/95 px-3 py-2 shadow-sm"
      >
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">
              工作台 Harness
            </span>
            <Badge variant={runStateMeta.variant}>{runStateMeta.label}</Badge>
            {pendingCount > 0 ? (
              <Badge variant="destructive">{`待处理 ${pendingCount}`}</Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {runStateMeta.description}
            </span>
          </div>

          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Workflow className="h-3.5 w-3.5" />
                当前阶段
              </div>
              <div className="truncate text-sm font-semibold text-foreground">
                {stageTitle}
              </div>
              <p className="truncate text-[11px] text-muted-foreground">
                {stageDescription}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                最新运行
              </div>
              <div className="truncate text-sm font-semibold text-foreground">
                {resolvedRunTitle}
              </div>
              <p className="truncate text-[11px] text-muted-foreground">
                便于快速定位当前编排链路
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                产物摘要
              </div>
              <div className="text-sm font-semibold text-foreground">
                {artifactSummary}
              </div>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                最近更新 {updatedAtLabel}
              </p>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant={harnessPanelVisible ? "secondary" : "outline"}
            data-testid="theme-workbench-harness-toggle"
            onClick={onToggleHarnessPanel}
            className="h-9 shrink-0"
          >
            {harnessPanelVisible ? "收起 Harness" : "查看 Harness"}
          </Button>
        </div>
      </div>
    );
  }

  if (layout === "sidebar") {
    return (
      <div
        data-testid="theme-workbench-harness-card"
        data-run-state={runState}
        data-layout="sidebar"
        className="rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                工作台 Harness
              </span>
              <Badge variant={runStateMeta.variant}>{runStateMeta.label}</Badge>
              {pendingCount > 0 ? (
                <Badge variant="destructive">{`待处理 ${pendingCount}`}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {runStateMeta.description}
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-border/60 bg-muted/35 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            当前阶段
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {stageTitle}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {stageDescription}
          </p>

          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                最新运行
              </span>
              <span className="min-w-0 flex-1 text-right font-medium text-foreground">
                {resolvedRunTitle}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                产物摘要
              </span>
              <span className="font-medium text-foreground">
                {artifactSummary}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                最近更新
              </span>
              <span className="font-medium text-foreground">
                {updatedAtLabel}
              </span>
            </div>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant={harnessPanelVisible ? "secondary" : "outline"}
          data-testid="theme-workbench-harness-toggle"
          onClick={onToggleHarnessPanel}
          className="mt-3 h-8 w-full"
        >
          {harnessPanelVisible ? "收起 Harness" : "查看 Harness"}
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="theme-workbench-harness-card"
      data-run-state={runState}
      data-layout="card"
      className="mx-4 mb-3 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  工作台 Harness
                </span>
                <Badge variant={runStateMeta.variant}>
                  {runStateMeta.label}
                </Badge>
                {pendingCount > 0 ? (
                  <Badge variant="destructive">{`待处理 ${pendingCount}`}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {runStateMeta.description}
              </p>
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={harnessPanelVisible ? "secondary" : "outline"}
          data-testid="theme-workbench-harness-toggle"
          onClick={onToggleHarnessPanel}
          className="shrink-0"
        >
          {harnessPanelVisible ? "收起 Harness" : "查看 Harness"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            当前阶段
          </div>
          <div className="text-sm font-semibold text-foreground">
            {stageTitle}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {stageDescription}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            最新运行
          </div>
          <div className="text-sm font-semibold text-foreground">
            {resolvedRunTitle}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {runTitle
              ? "展示最近一次工作台编排的标题，便于快速定位当前链路。"
              : "输入目标后，Harness 会在这里显示当前运行标题。"}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" />
            产物摘要
          </div>
          <div className="text-sm font-semibold text-foreground">
            {artifactSummary}
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs leading-5 text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            最近更新时间 {updatedAtLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
