import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ImagePlus,
  Library,
  Maximize2,
  Minus,
  Move,
  Plus,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveImageWorkbenchCanvasLayout,
  resolveImageWorkbenchFitViewport,
} from "./imageWorkbenchCanvasLayout";

export type ImageWorkbenchTaskMode = "generate" | "edit" | "variation";
export type ImageWorkbenchTaskStatus =
  | "queued"
  | "routing"
  | "running"
  | "partial"
  | "complete"
  | "error";

export interface ImageWorkbenchViewport {
  x: number;
  y: number;
  scale: number;
}

export interface ImageWorkbenchTaskView {
  id: string;
  mode: ImageWorkbenchTaskMode;
  status: ImageWorkbenchTaskStatus;
  prompt: string;
  rawText: string;
  expectedCount: number;
  outputIds: string[];
  targetOutputId?: string | null;
  createdAt: number;
  failureMessage?: string;
}

export interface ImageWorkbenchOutputView {
  id: string;
  refId: string;
  taskId: string;
  url: string;
  prompt: string;
  createdAt: number;
  providerName?: string;
  modelName?: string;
  size?: string;
  parentOutputId?: string | null;
  resourceSaved?: boolean;
}

interface ImageWorkbenchCanvasProps {
  tasks: ImageWorkbenchTaskView[];
  outputs: ImageWorkbenchOutputView[];
  selectedOutputId: string | null;
  viewport: ImageWorkbenchViewport;
  preferenceSummary?: string | null;
  preferenceWarning?: string | null;
  availableProviders: Array<{ id: string; name?: string }>;
  selectedProviderId: string;
  onProviderChange: (providerId: string) => void;
  availableModels: Array<{
    id: string;
    name: string;
    supportedSizes: string[];
  }>;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  selectedSize: string;
  onSizeChange: (size: string) => void;
  generating: boolean;
  savingToResource: boolean;
  onStopGeneration?: () => void;
  onViewportChange: (viewport: ImageWorkbenchViewport) => void;
  onSelectOutput: (outputId: string) => void;
  onSaveSelectedToLibrary?: () => void;
  applySelectedOutputLabel?: string;
  onApplySelectedOutput?: () => void;
  onSeedFollowUpCommand?: (command: string) => void;
  onOpenImage?: (url: string) => void;
}

const DEFAULT_IMAGE_WORKBENCH_SIZES = [
  "1024x1024",
  "1792x1024",
  "1024x1792",
];

function formatTaskModeLabel(mode: ImageWorkbenchTaskMode): string {
  switch (mode) {
    case "edit":
      return "编辑";
    case "variation":
      return "变体";
    case "generate":
    default:
      return "生成";
  }
}

function formatTaskStatusLabel(status: ImageWorkbenchTaskStatus): string {
  switch (status) {
    case "queued":
      return "已创建";
    case "routing":
      return "路由中";
    case "running":
      return "生成中";
    case "partial":
      return "部分完成";
    case "complete":
      return "已完成";
    case "error":
      return "失败";
    default:
      return "处理中";
  }
}

function resolveTaskStatusClassName(status: ImageWorkbenchTaskStatus): string {
  switch (status) {
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
    case "routing":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "queued":
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function clampScale(value: number): number {
  return Math.min(Math.max(value, 0.55), 1.9);
}

function resolveRemainingSlots(
  task: ImageWorkbenchTaskView,
  taskOutputs: ImageWorkbenchOutputView[],
): number {
  return Math.max(0, task.expectedCount - taskOutputs.length);
}

interface WorkbenchSelectChipOption {
  id: string;
  label: string;
}

interface WorkbenchSelectChipProps {
  label: string;
  value: string;
  placeholder: string;
  options: WorkbenchSelectChipOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

function WorkbenchSelectChip({
  label,
  value,
  placeholder,
  options,
  disabled = false,
  onChange,
}: WorkbenchSelectChipProps) {
  return (
    <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-2xl border border-white bg-white px-3 py-2 shadow-sm shadow-slate-950/[0.02]">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-5 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-400"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface WorkbenchActionButtonProps {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  onClick?: () => void;
}

function WorkbenchActionButton({
  icon,
  label,
  disabled = false,
  tone = "default",
  onClick,
}: WorkbenchActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary"
          ? "border-slate-900 bg-slate-900 text-white hover:border-slate-800 hover:bg-slate-800"
          : tone === "danger"
            ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white hover:text-slate-950",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface WorkbenchBadgeProps {
  children: React.ReactNode;
  className?: string;
}

function WorkbenchBadge({ children, className }: WorkbenchBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const ImageWorkbenchCanvas: React.FC<ImageWorkbenchCanvasProps> = ({
  tasks,
  outputs,
  selectedOutputId,
  viewport,
  preferenceSummary,
  preferenceWarning,
  availableProviders,
  selectedProviderId,
  onProviderChange,
  availableModels,
  selectedModelId,
  onModelChange,
  selectedSize,
  onSizeChange,
  generating,
  savingToResource,
  onStopGeneration,
  onViewportChange,
  onSelectOutput,
  onSaveSelectedToLibrary,
  applySelectedOutputLabel = "应用到画布",
  onApplySelectedOutput,
  onSeedFollowUpCommand,
  onOpenImage,
}) => {
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const layoutSignatureRef = useRef("");
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [canvasViewportSize, setCanvasViewportSize] = useState({
    width: 0,
    height: 0,
  });
  const selectedOutput =
    outputs.find((item) => item.id === selectedOutputId) || outputs[0] || null;
  const selectedTaskId = selectedOutput?.taskId ?? tasks[0]?.id ?? null;
  const selectedModel = useMemo(
    () => availableModels.find((item) => item.id === selectedModelId) || null,
    [availableModels, selectedModelId],
  );
  const availableSizes = useMemo(
    () =>
      selectedModel?.supportedSizes?.length
        ? selectedModel.supportedSizes
        : DEFAULT_IMAGE_WORKBENCH_SIZES,
    [selectedModel],
  );
  const providerOptions = useMemo(
    () =>
      availableProviders.map((provider) => ({
        id: provider.id,
        label: provider.name?.trim() || provider.id,
      })),
    [availableProviders],
  );
  const modelOptions = useMemo(
    () =>
      availableModels.map((model) => ({
        id: model.id,
        label: model.name,
      })),
    [availableModels],
  );
  const sizeOptions = useMemo(
    () =>
      availableSizes.map((size) => ({
        id: size,
        label: size,
      })),
    [availableSizes],
  );
  const taskMetrics = useMemo(
    () =>
      tasks.map((task) => ({
        expectedCount: task.expectedCount,
        outputCount: outputs.filter((output) => output.taskId === task.id).length,
        hasFailureMessage: Boolean(task.failureMessage),
        expanded: expandedTaskId === task.id,
      })),
    [expandedTaskId, outputs, tasks],
  );
  const canvasLayout = useMemo(
    () =>
      resolveImageWorkbenchCanvasLayout({
        tasks: taskMetrics,
        containerWidth: canvasViewportSize.width,
        containerHeight: canvasViewportSize.height,
      }),
    [canvasViewportSize.height, canvasViewportSize.width, taskMetrics],
  );

  useEffect(() => {
    if (!expandedTaskId) {
      return;
    }

    if (!tasks.some((task) => task.id === expandedTaskId)) {
      setExpandedTaskId(null);
    }
  }, [expandedTaskId, tasks]);

  useEffect(() => {
    const element = canvasViewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextEntry = entries[0];
      if (!nextEntry) {
        return;
      }
      const { width, height } = nextEntry.contentRect;
      setCanvasViewportSize((current) => {
        const nextWidth = Math.round(width);
        const nextHeight = Math.round(height);
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleZoom = (delta: number) => {
    onViewportChange({
      ...viewport,
      scale: clampScale(viewport.scale + delta),
    });
  };

  const handleResetView = () => {
    onViewportChange({ x: 0, y: 0, scale: 1 });
  };

  const handleFitView = () => {
    if (!canvasViewportSize.width || !canvasViewportSize.height) {
      return;
    }
    onViewportChange(
      resolveImageWorkbenchFitViewport({
        containerWidth: canvasViewportSize.width,
        containerHeight: canvasViewportSize.height,
        boardWidth: canvasLayout.boardWidth,
        boardHeight: canvasLayout.boardHeight,
      }),
    );
  };

  const handleViewportMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-image-pan-block='true'],button,select")) {
      return;
    }

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    setIsDraggingCanvas(true);
  };

  const handleViewportMouseMove = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    onViewportChange({
      ...viewport,
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    });
  };

  const stopDragging = () => {
    dragStateRef.current = null;
    setIsDraggingCanvas(false);
  };

  const handleExpandTask = (
    taskId: string,
    fallbackOutputId?: string | null,
  ) => {
    setExpandedTaskId(taskId);
    if (
      fallbackOutputId &&
      (!selectedOutput || selectedOutput.taskId !== taskId)
    ) {
      onSelectOutput(fallbackOutputId);
    }
  };

  const handleViewportWheel = (
    event: React.WheelEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const nextScale = clampScale(
        viewport.scale + (event.deltaY < 0 ? 0.08 : -0.08),
      );
      onViewportChange({
        ...viewport,
        scale: nextScale,
      });
      return;
    }

    onViewportChange({
      ...viewport,
      x: viewport.x - event.deltaX,
      y: viewport.y - event.deltaY,
    });
  };

  useEffect(() => {
    const nextSignature = JSON.stringify({
      width: canvasViewportSize.width,
      height: canvasViewportSize.height,
      tasks: tasks.map((task) => ({
        id: task.id,
        status: task.status,
        expectedCount: task.expectedCount,
        outputIds: task.outputIds.length,
        failure: task.failureMessage || "",
      })),
      outputCount: outputs.length,
    });

    if (layoutSignatureRef.current === nextSignature) {
      return;
    }
    layoutSignatureRef.current = nextSignature;

    const viewportIsDefault =
      Math.abs(viewport.x) < 1 &&
      Math.abs(viewport.y) < 1 &&
      Math.abs(viewport.scale - 1) < 0.01;

    if (
      !viewportIsDefault ||
      !canvasViewportSize.width ||
      !canvasViewportSize.height
    ) {
      return;
    }

    onViewportChange(
      resolveImageWorkbenchFitViewport({
        containerWidth: canvasViewportSize.width,
        containerHeight: canvasViewportSize.height,
        boardWidth: canvasLayout.boardWidth,
        boardHeight: canvasLayout.boardHeight,
      }),
    );
  }, [
    canvasLayout.boardHeight,
    canvasLayout.boardWidth,
    canvasViewportSize.height,
    canvasViewportSize.width,
    onViewportChange,
    outputs.length,
    tasks,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_100%)] shadow-sm shadow-slate-950/5">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              <ImagePlus className="h-4 w-4 text-sky-600" />
              <span>图片画布</span>
              {generating ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                  处理中
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
              <span>结果留在任务卡内，对话区会同步进度与结果摘要。</span>
              {preferenceSummary ? (
                <span
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600"
                  data-testid="image-workbench-preference-summary"
                >
                  {preferenceSummary}
                </span>
              ) : null}
            </div>
            {preferenceWarning ? (
              <div
                className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700"
                data-testid="image-workbench-preference-warning"
              >
                {preferenceWarning}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {generating && onStopGeneration ? (
              <WorkbenchActionButton
                icon={<span className="h-2.5 w-2.5 rounded-[2px] bg-current" />}
                label="停止"
                tone="danger"
                onClick={onStopGeneration}
              />
            ) : null}
            <div
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-500"
              data-testid="image-workbench-view-scale"
            >
              <Move className="h-3.5 w-3.5" />
              <span>{Math.round(viewport.scale * 100)}%</span>
            </div>
            <div className="inline-flex flex-wrap items-center gap-1 rounded-[18px] border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => handleZoom(-0.1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white bg-white text-slate-600 hover:border-slate-200 hover:text-slate-900"
                aria-label="缩小画布"
                title="缩小"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleZoom(0.1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white bg-white text-slate-600 hover:border-slate-200 hover:text-slate-900"
                aria-label="放大画布"
                title="放大"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleFitView}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white bg-white px-3 text-sm text-slate-600 hover:border-slate-200 hover:text-slate-900"
                aria-label="适配画布到视口"
                title="适配画布到视口"
              >
                <Maximize2 className="h-4 w-4" />
                <span>适配</span>
              </button>
              <button
                type="button"
                onClick={handleResetView}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white bg-white px-3 text-sm text-slate-600 hover:border-slate-200 hover:text-slate-900"
                aria-label="重置画布视图"
                title="重置画布视图"
              >
                <Move className="h-4 w-4" />
                <span>归位</span>
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[20px] border border-slate-200 bg-slate-50 p-2">
          <WorkbenchSelectChip
            label="服务"
            value={selectedProviderId}
            placeholder="未锁定服务"
            options={providerOptions}
            onChange={onProviderChange}
          />
          <WorkbenchSelectChip
            label="模型"
            value={selectedModelId}
            placeholder="未锁定模型"
            options={modelOptions}
            disabled={availableModels.length === 0}
            onChange={onModelChange}
          />
          <WorkbenchSelectChip
            label="尺寸"
            value={selectedSize}
            placeholder="自动尺寸"
            options={sizeOptions}
            onChange={onSizeChange}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <div
          ref={canvasViewportRef}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50",
            isDraggingCanvas ? "cursor-grabbing" : "cursor-grab",
          )}
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          onWheel={handleViewportWheel}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(125,211,252,0.12),transparent_28%),radial-gradient(circle_at_82%_14%,rgba(167,243,208,0.09),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,1)_58%,rgba(241,245,249,1)_100%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-70 bg-[linear-gradient(rgba(226,232,240,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(226,232,240,0.22)_1px,transparent_1px)] bg-[size:44px_44px]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_44%,rgba(248,250,252,0.35)_82%,rgba(248,250,252,0.78)_100%)]" />
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="px-6 py-8"
              style={{
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                transformOrigin: "0 0",
                width: canvasLayout.surfaceWidth,
                minHeight: canvasLayout.surfaceHeight,
              }}
            >
              <div
                className="mx-auto"
                style={{
                  width: canvasLayout.boardWidth,
                }}
              >
                {tasks.length === 0 ? (
                  <div className="flex h-[380px] w-[640px] flex-col justify-center rounded-[28px] border border-dashed border-slate-200 bg-white px-8 text-slate-500 shadow-sm shadow-slate-950/5">
                    <div className="text-sm font-semibold text-slate-900">
                      用 `@配图` 开始创建图片任务
                    </div>
                    <div className="mt-4 space-y-2 text-sm leading-6">
                      <div>`@配图 生成 公众号头图，科技感，16:9`</div>
                      <div>`@配图 编辑 #img-1 去掉文字，保留主体`</div>
                      <div>`@配图 重绘 #img-2 更偏插画风，出 4 张`</div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="grid content-start gap-6"
                    style={{
                      gridTemplateColumns: `repeat(${canvasLayout.columns}, minmax(0, ${canvasLayout.cardWidth}px))`,
                    }}
                  >
                    {tasks.map((task) => {
                      const taskOutputs = outputs
                        .filter((output) => output.taskId === task.id)
                        .sort((left, right) => left.createdAt - right.createdAt);
                      const remainingSlots = resolveRemainingSlots(task, taskOutputs);
                      const tileCount = Math.max(
                        1,
                        taskOutputs.length + remainingSlots,
                      );
                      const tileColumnCount = tileCount === 1 ? 1 : 2;
                      const tileHeightClass =
                        tileColumnCount === 1 ? "h-56" : "h-48";
                      const focusOutput =
                        taskOutputs.find((output) => output.id === selectedOutput?.id) ||
                        taskOutputs[0] ||
                        null;
                      const isSelectedTask = selectedTaskId === task.id;
                      const isExpandedTask = expandedTaskId === task.id;
                      const createdTimeLabel = new Date(task.createdAt).toLocaleTimeString(
                        [],
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      );
                      const outputSummaryLabel =
                        task.expectedCount > 0
                          ? `${taskOutputs.length}/${task.expectedCount} 输出`
                          : `${taskOutputs.length} 输出`;

                      return (
                        <section
                          key={task.id}
                          data-image-pan-block="true"
                          data-testid={`image-workbench-task-${task.id}`}
                          data-expanded={isExpandedTask ? "true" : "false"}
                          onClick={() =>
                            handleExpandTask(task.id, taskOutputs[0]?.id ?? null)
                          }
                          className={cn(
                            "flex min-w-0 flex-col rounded-[28px] border border-slate-200/90 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] transition-all",
                            isExpandedTask
                              ? "border-sky-300 ring-2 ring-sky-100 shadow-sky-950/10"
                              : isSelectedTask
                                ? "border-sky-200 shadow-sky-950/5"
                              : "border-slate-200",
                          )}
                        >
                          <div className="grid min-h-[118px] content-start gap-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[15px] font-semibold text-slate-900">
                                    {formatTaskModeLabel(task.mode)}任务
                                  </span>
                                  <WorkbenchBadge
                                    className={cn(
                                      "px-2 py-0.5 text-[11px]",
                                      resolveTaskStatusClassName(task.status),
                                    )}
                                  >
                                    {formatTaskStatusLabel(task.status)}
                                  </WorkbenchBadge>
                                  {isExpandedTask ? (
                                    <WorkbenchBadge className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700">
                                      当前查看
                                    </WorkbenchBadge>
                                  ) : null}
                                </div>
                              </div>
                              <WorkbenchBadge className="shrink-0 border-slate-200 bg-slate-50 text-slate-500">
                                {createdTimeLabel}
                              </WorkbenchBadge>
                            </div>
                            <p className="min-h-[68px] line-clamp-3 text-sm leading-6 text-slate-600">
                              {task.prompt || task.rawText || "未提供提示词"}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <WorkbenchBadge
                                className="border-slate-200 bg-slate-50 text-slate-600"
                              >
                                {outputSummaryLabel}
                              </WorkbenchBadge>
                              {taskOutputs.length > 1 ? (
                                <WorkbenchBadge
                                  className="border-slate-200 bg-slate-50 text-slate-600"
                                >
                                  {taskOutputs.length} 个版本
                                </WorkbenchBadge>
                              ) : null}
                              {remainingSlots > 0 ? (
                                <WorkbenchBadge
                                  className="border-amber-200 bg-amber-50 text-amber-700"
                                >
                                  还差 {remainingSlots} 张
                                </WorkbenchBadge>
                              ) : null}
                            </div>
                          </div>
                          {task.failureMessage ? (
                            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                              {task.failureMessage}
                            </div>
                          ) : null}
                          <div
                            className="mt-4 grid gap-3"
                            style={{
                              gridTemplateColumns: `repeat(${tileColumnCount}, minmax(0, 1fr))`,
                            }}
                          >
                            {taskOutputs.map((output) => {
                              const isSelected = selectedOutput?.id === output.id;
                              return (
                                <button
                                  key={output.id}
                                  type="button"
                                  data-image-tile="true"
                                  onClick={() => {
                                    onSelectOutput(output.id);
                                    handleExpandTask(task.id, output.id);
                                  }}
                                  className={cn(
                                    "group relative overflow-hidden rounded-[22px] border bg-slate-100 text-left shadow-sm transition-all",
                                    isSelected
                                      ? "border-sky-300 shadow-sky-950/10"
                                      : "border-slate-200 hover:border-slate-300",
                                  )}
                                >
                                  <img
                                    src={output.url}
                                    alt={output.prompt || output.refId}
                                    className={cn(
                                      "w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
                                      tileHeightClass,
                                    )}
                                  />
                                  <div className="absolute left-3 top-3 rounded-full bg-slate-950/75 px-2 py-0.5 text-[11px] font-semibold text-white">
                                    #{output.refId}
                                  </div>
                                </button>
                              );
                            })}
                            {Array.from({ length: remainingSlots }).map((_, index) => (
                              <div
                                key={`${task.id}-slot-${index}`}
                                className={cn(
                                  "flex items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50",
                                  tileHeightClass,
                                )}
                              >
                                <div className="h-20 w-20 animate-pulse rounded-2xl bg-slate-200" />
                              </div>
                            ))}
                          </div>
                          {isExpandedTask ? (
                            <div
                              className="mt-4 border-t border-slate-200 pt-4"
                              data-testid={`image-workbench-task-detail-${task.id}`}
                            >
                              {focusOutput ? (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    <span>当前查看</span>
                                    <WorkbenchBadge className="border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] tracking-normal text-sky-700 normal-case">
                                      #{focusOutput.refId}
                                    </WorkbenchBadge>
                                    {focusOutput.parentOutputId ? (
                                      <WorkbenchBadge className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] tracking-normal text-slate-600 normal-case">
                                        来源于 {focusOutput.parentOutputId}
                                      </WorkbenchBadge>
                                    ) : null}
                                    {focusOutput.providerName ? (
                                      <WorkbenchBadge className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] tracking-normal text-slate-600 normal-case">
                                        {focusOutput.providerName}
                                      </WorkbenchBadge>
                                    ) : null}
                                    {focusOutput.modelName ? (
                                      <WorkbenchBadge className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] tracking-normal text-slate-600 normal-case">
                                        {focusOutput.modelName}
                                      </WorkbenchBadge>
                                    ) : null}
                                    {focusOutput.size ? (
                                      <WorkbenchBadge className="border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] tracking-normal text-slate-600 normal-case">
                                        {focusOutput.size}
                                      </WorkbenchBadge>
                                    ) : null}
                                  </div>

                                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.12),transparent_46%),linear-gradient(180deg,rgba(248,250,252,0.94)_0%,rgba(255,255,255,0.98)_100%)]">
                                    <div className="flex min-h-[380px] items-center justify-center bg-white px-3 py-3">
                                      <img
                                        src={focusOutput.url}
                                        alt={focusOutput.prompt || focusOutput.refId}
                                        className="max-h-[460px] w-full object-contain"
                                      />
                                    </div>
                                    <div className="border-t border-slate-200 bg-white px-4 py-3">
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1 rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                                          <div className="text-[11px] font-medium text-slate-500">
                                            提示词
                                          </div>
                                          <p className="mt-1 line-clamp-4 text-sm leading-6 text-slate-600">
                                            {focusOutput.prompt ||
                                              task.prompt ||
                                              task.rawText ||
                                              "当前结果未附带额外提示词"}
                                          </p>
                                        </div>
                                        <div className="flex max-w-full flex-wrap justify-end gap-2">
                                          <WorkbenchActionButton
                                            icon={<Wand2 className="h-4 w-4" />}
                                            label="编辑"
                                            onClick={() =>
                                              onSeedFollowUpCommand?.(
                                                `@配图 编辑 #${focusOutput.refId} `,
                                              )
                                            }
                                          />
                                          <WorkbenchActionButton
                                            icon={<Sparkles className="h-4 w-4" />}
                                            label="变体"
                                            onClick={() =>
                                              onSeedFollowUpCommand?.(
                                                `@配图 重绘 #${focusOutput.refId} `,
                                              )
                                            }
                                          />
                                          <WorkbenchActionButton
                                            icon={<Library className="h-4 w-4" />}
                                            label={savingToResource ? "入库中" : "入库"}
                                            disabled={
                                              !onSaveSelectedToLibrary || savingToResource
                                            }
                                            onClick={onSaveSelectedToLibrary}
                                          />
                                          <WorkbenchActionButton
                                            icon={<ImagePlus className="h-4 w-4" />}
                                            label={applySelectedOutputLabel}
                                            tone="primary"
                                            disabled={!onApplySelectedOutput}
                                            onClick={onApplySelectedOutput}
                                          />
                                          <WorkbenchActionButton
                                            icon={<ArrowUpRight className="h-4 w-4" />}
                                            label="原图"
                                            onClick={() => onOpenImage?.(focusOutput.url)}
                                          />
                                        </div>
                                      </div>

                                      {taskOutputs.length > 1 ? (
                                        <div
                                          className="mt-4 border-t border-slate-100 pt-3"
                                          data-testid={`image-workbench-task-versions-${task.id}`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                                            <span className="font-medium">切换版本</span>
                                            <span>{taskOutputs.length} 个结果</span>
                                          </div>
                                          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                            {taskOutputs.map((output) => {
                                              const isSelected =
                                                selectedOutput?.id === output.id;
                                              return (
                                                <button
                                                  key={output.id}
                                                  type="button"
                                                  onClick={() => {
                                                    onSelectOutput(output.id);
                                                    handleExpandTask(task.id, output.id);
                                                  }}
                                                  className={cn(
                                                    "group relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl border bg-slate-100 transition-all",
                                                    isSelected
                                                      ? "border-slate-900 shadow-sm shadow-slate-950/8"
                                                      : "border-slate-200 opacity-60 hover:border-slate-300 hover:opacity-90",
                                                  )}
                                                  aria-label={`切换到版本 ${output.refId}`}
                                                >
                                                  <img
                                                    src={output.url}
                                                    alt={output.refId}
                                                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                                                  />
                                                  <div className="absolute inset-x-2 bottom-2 flex justify-end">
                                                    <span
                                                      className={cn(
                                                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                                        isSelected
                                                          ? "bg-slate-950 text-white"
                                                          : "bg-white/92 text-slate-600",
                                                      )}
                                                    >
                                                      {output.refId}
                                                    </span>
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    <span>当前查看</span>
                                  </div>
                                  <p className="mt-3 text-sm leading-6 text-slate-600">
                                    {task.prompt || task.rawText || "当前任务还没有补充提示词。"}
                                  </p>
                                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                                    {task.status === "error"
                                      ? "可以在右侧继续补充说明，或重新发起一次编辑/变体任务。"
                                      : "结果返回后会直接补进这张任务卡。"}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
