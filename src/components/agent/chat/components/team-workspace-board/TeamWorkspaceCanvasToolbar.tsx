import { Button } from "@/components/ui/button";

interface TeamWorkspaceCanvasToolbarProps {
  laneCount: number;
  onAutoArrangeCanvas: () => void;
  onFitCanvasView: () => void;
  onResetCanvasView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number;
}

export function TeamWorkspaceCanvasToolbar({
  laneCount,
  onAutoArrangeCanvas,
  onFitCanvasView,
  onResetCanvasView,
  onZoomIn,
  onZoomOut,
  zoom,
}: TeamWorkspaceCanvasToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
          自由画布
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
          缩放 {Math.round(zoom * 100)}%
        </span>
        {laneCount > 0 ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
            {laneCount} 个成员面板
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAutoArrangeCanvas}
          data-testid="team-workspace-auto-arrange-button"
        >
          整理布局
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onZoomOut}>
          缩小
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onZoomIn}>
          放大
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onResetCanvasView}
        >
          100%
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onFitCanvasView}
        >
          适应视图
        </Button>
      </div>
    </div>
  );
}
