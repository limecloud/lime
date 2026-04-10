import {
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceCanvasLane } from "../../team-workspace-runtime/canvasLaneSelectors";
import type {
  TeamWorkspaceCanvasItemLayout,
  TeamWorkspaceCanvasLayoutState,
} from "../../utils/teamWorkspaceCanvas";
import {
  TeamWorkspaceCanvasLaneCard,
  type TeamWorkspaceCanvasResizeDirection,
} from "./TeamWorkspaceCanvasLaneCard";

interface TeamWorkspaceCanvasStageProps {
  canvasBoundsHeight: number;
  canvasBoundsWidth: number;
  canvasStageHeight: number | string;
  canvasStageHint: string;
  expandedSessionId?: string | null;
  isCanvasPanModifierActive: boolean;
  laneLayouts: Record<string, TeamWorkspaceCanvasItemLayout>;
  lanes: TeamWorkspaceCanvasLane[];
  onCanvasWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onSelectLane: (lane: TeamWorkspaceCanvasLane) => void;
  onStartCanvasLaneDrag: (
    lane: TeamWorkspaceCanvasLane,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onStartCanvasLaneResize: (
    lane: TeamWorkspaceCanvasLane,
    direction: TeamWorkspaceCanvasResizeDirection,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void;
  onStartCanvasPan: (event: ReactMouseEvent<HTMLDivElement>) => void;
  renderSelectedInlineDetail?: (lane: TeamWorkspaceCanvasLane) => ReactNode;
  selectedSessionId?: string | null;
  viewport: TeamWorkspaceCanvasLayoutState["viewport"];
  viewportRef: Ref<HTMLDivElement>;
}

export function TeamWorkspaceCanvasStage({
  canvasBoundsHeight,
  canvasBoundsWidth,
  canvasStageHeight,
  canvasStageHint,
  expandedSessionId,
  isCanvasPanModifierActive,
  laneLayouts,
  lanes,
  onCanvasWheel,
  onSelectLane,
  onStartCanvasLaneDrag,
  onStartCanvasLaneResize,
  onStartCanvasPan,
  renderSelectedInlineDetail,
  selectedSessionId,
  viewport,
  viewportRef,
}: TeamWorkspaceCanvasStageProps) {
  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] shadow-sm shadow-slate-950/5 cursor-grab active:cursor-grabbing",
        isCanvasPanModifierActive && "cursor-grabbing",
      )}
      data-testid="team-workspace-rail-list"
      data-layout-kind="free-canvas"
      data-viewport-x={Math.round(viewport.x)}
      data-viewport-y={Math.round(viewport.y)}
      data-viewport-zoom={viewport.zoom.toFixed(2)}
      data-pan-mode={isCanvasPanModifierActive ? "active" : "idle"}
      style={{ height: canvasStageHeight }}
      onMouseDown={onStartCanvasPan}
      onWheel={onCanvasWheel}
    >
      <div
        data-testid="team-workspace-canvas-pan-surface"
        data-team-workspace-canvas-pan-surface="true"
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div
        data-team-workspace-canvas-pan-block="true"
        className="absolute left-4 top-4 z-10 inline-flex max-w-[320px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-slate-500 shadow-sm shadow-slate-950/5"
        data-testid="team-workspace-canvas-shortcuts"
      >
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">
          画布
        </span>
        <span className="truncate">空白处拖拽 · Space 手型 · A 整理 · F 适应</span>
      </div>
      {lanes.length > 0 ? (
        <div
          data-team-workspace-canvas-pan-surface="true"
          className="absolute inset-0 overflow-hidden"
          data-testid="team-workspace-canvas-stage"
        >
          <div
            data-team-workspace-canvas-pan-surface="true"
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px)`,
            }}
          >
            <div
              data-team-workspace-canvas-pan-surface="true"
              className="relative"
              style={{
                width: `${canvasBoundsWidth}px`,
                height: `${canvasBoundsHeight}px`,
                transform: `scale(${viewport.zoom})`,
                transformOrigin: "top left",
              }}
            >
              {lanes.map((lane) => {
                const layout = laneLayouts[lane.persistKey];
                const selected =
                  lane.session?.id != null && selectedSessionId === lane.session.id;
                const expanded =
                  selected &&
                  lane.session?.id != null &&
                  expandedSessionId === lane.session.id;

                return (
                  <TeamWorkspaceCanvasLaneCard
                    key={lane.persistKey}
                    expanded={expanded}
                    lane={lane}
                    layout={layout}
                    onSelectLane={() => onSelectLane(lane)}
                    onStartDrag={(event) => onStartCanvasLaneDrag(lane, event)}
                    onStartResize={(direction, event) =>
                      onStartCanvasLaneResize(lane, direction, event)
                    }
                    selected={selected}
                    selectedInlineDetail={
                      expanded ? renderSelectedInlineDetail?.(lane) ?? null : null
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-[520px] rounded-[24px] border border-dashed border-slate-300 bg-white/92 px-6 py-5 text-center shadow-sm shadow-slate-950/5">
            <div className="text-sm font-semibold text-slate-900">
              暂无协作画布
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {canvasStageHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
