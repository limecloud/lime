import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceBoardChromeDisplayState } from "../../team-workspace-runtime/boardChromeSelectors";
import type { TeamWorkspaceRuntimeStatus } from "../../teamWorkspaceRuntime";

interface TeamWorkspaceStatusMeta {
  badgeClassName: string;
}

interface TeamWorkspaceTeamActionButtonsProps {
  canCloseCompletedTeamSessions: boolean;
  canWaitAnyActiveTeamSession: boolean;
  onCloseCompletedTeamSessions: () => void | Promise<void>;
  onWaitAnyActiveTeamSessions: () => void | Promise<void>;
  pendingTeamAction: "wait_any" | "close_completed" | null;
}

export function TeamWorkspaceTeamActionButtons({
  canCloseCompletedTeamSessions,
  canWaitAnyActiveTeamSession,
  onCloseCompletedTeamSessions,
  onWaitAnyActiveTeamSessions,
  pendingTeamAction,
}: TeamWorkspaceTeamActionButtonsProps) {
  return (
    <>
      {canWaitAnyActiveTeamSession ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendingTeamAction === "wait_any"}
          onClick={() => void onWaitAnyActiveTeamSessions()}
          data-testid="team-workspace-wait-active-button"
        >
          {pendingTeamAction === "wait_any" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {pendingTeamAction === "wait_any"
            ? "等待中..."
            : "等待任一成员结果"}
        </Button>
      ) : null}
      {canCloseCompletedTeamSessions ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendingTeamAction === "close_completed"}
          onClick={() => void onCloseCompletedTeamSessions()}
          data-testid="team-workspace-close-completed-button"
        >
          {pendingTeamAction === "close_completed" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {pendingTeamAction === "close_completed"
            ? "收起中..."
            : "收起已完成成员"}
        </Button>
      ) : null}
    </>
  );
}

interface TeamWorkspaceCanvasViewButtonsProps {
  onAutoArrangeCanvas: () => void;
  onFitCanvasView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function TeamWorkspaceCanvasViewButtons({
  onAutoArrangeCanvas,
  onFitCanvasView,
  onZoomIn,
  onZoomOut,
}: TeamWorkspaceCanvasViewButtonsProps) {
  return (
    <>
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
      <Button type="button" size="sm" variant="outline" onClick={onFitCanvasView}>
        适应视图
      </Button>
    </>
  );
}

interface TeamWorkspaceCompactToolbarChipProps {
  chip: TeamWorkspaceBoardChromeDisplayState["compactToolbarChips"][number];
  compactCanvasMutedChipClassName: string;
  compactCanvasSummaryChipClassName: string;
  resolveStatusMeta: (
    status?: TeamWorkspaceRuntimeStatus,
  ) => TeamWorkspaceStatusMeta;
}

export function TeamWorkspaceCompactToolbarChip({
  chip,
  compactCanvasMutedChipClassName,
  compactCanvasSummaryChipClassName,
  resolveStatusMeta,
}: TeamWorkspaceCompactToolbarChipProps) {
  if (chip.tone === "status") {
    return (
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-medium",
          resolveStatusMeta(chip.status).badgeClassName,
        )}
      >
        {chip.text}
      </span>
    );
  }

  return (
    <span
      className={
        chip.tone === "summary"
          ? compactCanvasSummaryChipClassName
          : compactCanvasMutedChipClassName
      }
    >
      {chip.text}
    </span>
  );
}
