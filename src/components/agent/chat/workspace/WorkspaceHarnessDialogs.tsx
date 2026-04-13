import type { ComponentProps } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AgentRuntimeStrip } from "../components/AgentRuntimeStrip";
import { HarnessStatusPanel } from "../components/HarnessStatusPanel";
import { TeamMemoryShadowCard } from "../components/TeamMemoryShadowCard";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";

type HarnessPanelBaseProps = Pick<
  ComponentProps<typeof HarnessStatusPanel>,
  | "harnessState"
  | "environment"
  | "childSubagentSessions"
  | "selectedTeamLabel"
  | "selectedTeamSummary"
  | "selectedTeamRoles"
  | "threadRead"
  | "turns"
  | "threadItems"
  | "currentTurnId"
  | "pendingActions"
  | "submittedActionsInFlight"
  | "queuedTurns"
  | "canInterrupt"
  | "onInterruptCurrentTurn"
  | "onResumeThread"
  | "onReplayPendingRequest"
  | "onPromoteQueuedTurn"
  | "onOpenMemoryWorkbench"
  | "messages"
  | "teamMemorySnapshot"
  | "diagnosticRuntimeContext"
  | "toolInventory"
  | "toolInventoryLoading"
  | "toolInventoryError"
  | "onRefreshToolInventory"
  | "onOpenSubagentSession"
  | "onLoadFilePreview"
  | "onOpenFile"
>;

interface GeneralWorkbenchHarnessDialogSectionProps extends HarnessPanelBaseProps {
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMemorySnapshot?: TeamMemorySnapshot | null;
}

export function GeneralWorkbenchHarnessDialogSection({
  enabled,
  open,
  onOpenChange,
  teamMemorySnapshot = null,
  ...panelBaseProps
}: GeneralWorkbenchHarnessDialogSectionProps) {
  if (!enabled) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-7xl"
        className="flex h-[90vh] max-h-[90vh] flex-col overflow-hidden p-0"
        draggable={true}
        dragHandleSelector='[data-harness-drag-handle="true"]'
      >
        <HarnessStatusPanel
          {...panelBaseProps}
          layout="dialog"
          teamMemorySnapshot={teamMemorySnapshot}
          leadContent={
            teamMemorySnapshot ? (
              <TeamMemoryShadowCard snapshot={teamMemorySnapshot} />
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

interface GeneralWorkbenchDialogSectionProps extends HarnessPanelBaseProps {
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTheme: ComponentProps<typeof AgentRuntimeStrip>["activeTheme"];
  toolPreferences: ComponentProps<typeof AgentRuntimeStrip>["toolPreferences"];
  isSending: ComponentProps<typeof AgentRuntimeStrip>["isSending"];
  executionRuntime: ComponentProps<
    typeof AgentRuntimeStrip
  >["executionRuntime"];
  isExecutionRuntimeActive: ComponentProps<
    typeof AgentRuntimeStrip
  >["isExecutionRuntimeActive"];
  runtimeStatusTitle: ComponentProps<
    typeof AgentRuntimeStrip
  >["runtimeStatusTitle"];
  selectedTeamRoleCount: ComponentProps<
    typeof AgentRuntimeStrip
  >["selectedTeamRoleCount"];
  teamMemorySnapshot?: TeamMemorySnapshot | null;
}

export function GeneralWorkbenchDialogSection({
  enabled,
  open,
  onOpenChange,
  activeTheme,
  toolPreferences,
  isSending,
  executionRuntime,
  isExecutionRuntimeActive,
  runtimeStatusTitle,
  selectedTeamRoleCount,
  teamMemorySnapshot = null,
  ...panelBaseProps
}: GeneralWorkbenchDialogSectionProps) {
  if (!enabled) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-6xl"
        className="flex h-[90vh] max-h-[90vh] flex-col overflow-hidden p-0"
        draggable={true}
        dragHandleSelector='[data-harness-drag-handle="true"]'
      >
        <HarnessStatusPanel
          {...panelBaseProps}
          layout="dialog"
          teamMemorySnapshot={teamMemorySnapshot}
          title="处理工作台"
          description="集中查看计划、待确认事项、任务进展、文件活动和处理结果。"
          toggleLabel="工作台详情"
          leadContent={
            <div className="space-y-3">
              <AgentRuntimeStrip
                activeTheme={activeTheme}
                toolPreferences={toolPreferences}
                harnessState={panelBaseProps.harnessState}
                childSubagentSessions={panelBaseProps.childSubagentSessions}
                variant="embedded"
                isSending={isSending}
                executionRuntime={executionRuntime}
                isExecutionRuntimeActive={isExecutionRuntimeActive}
                runtimeStatusTitle={runtimeStatusTitle}
                selectedTeamLabel={panelBaseProps.selectedTeamLabel}
                selectedTeamSummary={panelBaseProps.selectedTeamSummary}
                selectedTeamRoleCount={selectedTeamRoleCount}
              />
              {teamMemorySnapshot ? (
                <TeamMemoryShadowCard snapshot={teamMemorySnapshot} />
              ) : null}
            </div>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
