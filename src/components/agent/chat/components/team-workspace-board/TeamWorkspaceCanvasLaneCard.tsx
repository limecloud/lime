import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { PanelTop } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceCanvasLane } from "../../team-workspace-runtime/canvasLaneSelectors";
import type { TeamWorkspaceCanvasItemLayout } from "../../utils/teamWorkspaceCanvas";

export type TeamWorkspaceCanvasResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

interface TeamWorkspaceCanvasLaneCardProps {
  expanded: boolean;
  lane: TeamWorkspaceCanvasLane;
  layout: TeamWorkspaceCanvasItemLayout;
  onSelectLane: () => void;
  onStartDrag: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onStartResize: (
    direction: TeamWorkspaceCanvasResizeDirection,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void;
  selected: boolean;
  selectedInlineDetail?: ReactNode;
}

const RESIZE_HANDLES: Array<{
  className: string;
  direction: TeamWorkspaceCanvasResizeDirection;
}> = [
  {
    direction: "n",
    className:
      "left-1/2 top-0 h-3 w-14 -translate-x-1/2 -translate-y-1/2 cursor-n-resize",
  },
  {
    direction: "s",
    className:
      "bottom-0 left-1/2 h-3 w-14 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
  },
  {
    direction: "e",
    className:
      "right-0 top-1/2 h-14 w-3 -translate-y-1/2 translate-x-1/2 cursor-e-resize",
  },
  {
    direction: "w",
    className:
      "left-0 top-1/2 h-14 w-3 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
  },
  {
    direction: "ne",
    className:
      "right-0 top-0 h-4 w-4 translate-x-1/2 -translate-y-1/2 cursor-ne-resize",
  },
  {
    direction: "nw",
    className:
      "left-0 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
  },
  {
    direction: "se",
    className:
      "bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-se-resize",
  },
  {
    direction: "sw",
    className:
      "bottom-0 left-0 h-4 w-4 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
  },
];

export function TeamWorkspaceCanvasLaneCard({
  expanded,
  lane,
  layout,
  onSelectLane,
  onStartDrag,
  onStartResize,
  selected,
  selectedInlineDetail,
}: TeamWorkspaceCanvasLaneCardProps) {
  return (
    <div
      data-team-workspace-canvas-pan-block="true"
      data-testid={`team-workspace-member-lane-${lane.id}`}
      data-lane-x={Math.round(layout.x)}
      data-lane-y={Math.round(layout.y)}
      data-lane-width={Math.round(layout.width)}
      data-lane-height={Math.round(layout.height)}
      data-expanded={expanded ? "true" : "false"}
      className="absolute"
      onClick={onSelectLane}
      style={{
        transform: `translate(${layout.x}px, ${layout.y}px)`,
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        zIndex: layout.zIndex,
      }}
    >
      <div
        role={lane.session ? "button" : undefined}
        aria-pressed={lane.session ? selected : undefined}
        tabIndex={lane.session ? 0 : -1}
        onClick={onSelectLane}
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-[24px] border bg-white text-left shadow-[0_18px_52px_-32px_rgba(15,23,42,0.28)] transition",
          lane.kind === "planned"
            ? "border-dashed border-slate-300"
            : lane.kind === "runtime"
              ? "border-sky-200"
              : "border-slate-200",
          selected ? "ring-2 ring-slate-300" : "hover:border-slate-300",
        )}
      >
        <div
          data-testid={`team-workspace-member-lane-header-${lane.id}`}
          className="flex cursor-grab items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/88 px-4 py-3 active:cursor-grabbing"
          onMouseDown={onStartDrag}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900">
                {lane.title}
              </span>
              {lane.session?.isCurrent ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  当前
                </span>
              ) : null}
              {expanded ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                  当前查看
                </span>
              ) : null}
              {lane.kind === "runtime" ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                  当前分工
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              {lane.roleLabel ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                  分工 · {lane.roleLabel}
                </span>
              ) : null}
              {lane.profileLabel ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {lane.profileLabel}
                </span>
              ) : null}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  lane.badgeClassName,
                )}
              >
                {lane.badgeLabel}
              </span>
            </div>
          </div>
          <span
            className={cn(
              "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
              lane.dotClassName,
            )}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <p className="text-sm leading-6 text-slate-600">{lane.summary}</p>
          {lane.skillLabels.length > 0 || lane.presetLabel ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              {lane.presetLabel ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {lane.presetLabel}
                </span>
              ) : null}
              {lane.skillLabels.slice(0, 4).map((skillLabel) => (
                <span
                  key={`${lane.persistKey}-${skillLabel}`}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5"
                >
                  {skillLabel}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <PanelTop className="h-3 w-3" />
              <span>任务进展</span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                {lane.kind === "session" ? "最近进展" : "等待接入"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
                {lane.previewText}
              </p>
              {lane.previewEntries && lane.previewEntries.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {lane.previewEntries.map((entry) => (
                    <div
                      key={`${lane.persistKey}-${entry.id}`}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-slate-800">
                          {entry.title}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium",
                            entry.badgeClassName,
                          )}
                        >
                          {entry.statusLabel}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                        {entry.detail}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-1.5">
              {lane.statusHint ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {lane.statusHint}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {lane.updatedAtLabel ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {lane.updatedAtLabel}
                </span>
              ) : null}
              {lane.modelLabel ? (
                <span className="max-w-[180px] truncate rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {lane.modelLabel}
                </span>
              ) : null}
            </div>
          </div>
          {selectedInlineDetail}
        </div>
      </div>
      {RESIZE_HANDLES.map((handle) => (
        <span
          key={`${lane.persistKey}-${handle.direction}`}
          data-testid={`team-workspace-member-lane-resize-${lane.id}-${handle.direction}`}
          aria-hidden="true"
          className={cn(
            "absolute rounded-full border border-slate-300 bg-white shadow-sm",
            handle.className,
          )}
          onMouseDown={(event) => onStartResize(handle.direction, event)}
        />
      ))}
    </div>
  );
}
