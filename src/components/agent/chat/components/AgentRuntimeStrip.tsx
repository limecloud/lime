import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitCompare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentI18nKey } from "@/i18n/agentResources";
import { buildAgentUiCollaborationPayloadMetadata } from "@limecloud/agent-runtime-projection";
import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type { AgentRuntimeFileCheckpointThreadSummary } from "@/lib/api/agentRuntime/sessionTypes";

import type { CanonicalChildThreadSummary } from "../projection/canonicalChildThreadSummary";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { HarnessSessionState } from "../utils/harnessState";
import { getOutputSchemaRuntimeLabel } from "../utils/sessionExecutionRuntime";
import type { RuntimeToolAvailability } from "../utils/runtimeToolAvailability";

interface AgentRuntimeStripProps {
  activeTheme?: string;
  toolPreferences: ChatToolPreferences;
  runtimeToolAvailability?: RuntimeToolAvailability | null;
  harnessState: HarnessSessionState;
  canonicalChildren?: CanonicalChildThreadSummary[];
  variant?: "standalone" | "embedded";
  isSending?: boolean;
  executionRuntime?: AgentSessionExecutionRuntime | null;
  runtimeStatusTitle?: string | null;
  fileCheckpointSummary?: AgentRuntimeFileCheckpointThreadSummary | null;
  onOpenFileCheckpoints?: () => void;
}

interface CapabilityItem {
  key: string;
  label: string;
  enabled: boolean;
}

interface StatusItem {
  key: string;
  label: string;
  tone?: "default" | "outline" | "secondary";
}

interface RuntimeTeamStatusCounts {
  source: "canonical";
  active: number;
  completed: number;
  errored: number;
  interrupted: number;
  notFound: number;
  pendingInit: number;
  queued: number;
  running: number;
  shutdown: number;
  total: number;
}

function readFactString(
  facts: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = facts?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeRuntimeTeamStatus(
  canonicalChildren: CanonicalChildThreadSummary[],
): RuntimeTeamStatusCounts {
  const counts: RuntimeTeamStatusCounts = {
    source: "canonical",
    active: 0,
    completed: 0,
    errored: 0,
    interrupted: 0,
    notFound: 0,
    pendingInit: 0,
    queued: 0,
    running: 0,
    shutdown: 0,
    total: canonicalChildren.length,
  };

  for (const child of canonicalChildren) {
    switch (child.status) {
      case "pendingInit":
        counts.pendingInit += 1;
        counts.active += 1;
        break;
      case "running":
        counts.running += 1;
        counts.active += 1;
        break;
      case "interrupted":
        counts.interrupted += 1;
        break;
      case "completed":
        counts.completed += 1;
        break;
      case "errored":
        counts.errored += 1;
        break;
      case "shutdown":
        counts.shutdown += 1;
        break;
      case "notFound":
        counts.notFound += 1;
        break;
    }
  }
  return counts;
}

export const AgentRuntimeStrip: React.FC<AgentRuntimeStripProps> = ({
  toolPreferences,
  runtimeToolAvailability = null,
  harnessState,
  canonicalChildren = [],
  variant = "standalone",
  isSending = false,
  executionRuntime = null,
  runtimeStatusTitle = null,
  fileCheckpointSummary = null,
  onOpenFileCheckpoints,
}) => {
  const { t } = useTranslation("agent");
  const translate = useCallback(
    (key: AgentI18nKey, values?: Record<string, number | string>) =>
      t(key, values ?? {}),
    [t],
  );
  const fileCheckpointCount = fileCheckpointSummary?.count ?? 0;
  const hasRuntimeFileSignals =
    fileCheckpointCount > 0 ||
    harnessState.activeFileWrites.length > 0 ||
    harnessState.recentFileEvents.length > 0;
  const hasRuntimeOutputSignals = harnessState.outputSignals.length > 0;
  const hasRuntimeWorkbenchSignals =
    hasRuntimeFileSignals || hasRuntimeOutputSignals;
  const themeLabel = translate("agentChat.runtimeStrip.theme.general");
  const stripTitle = translate("agentChat.runtimeStrip.title.general");
  const canReviewFileCheckpoints =
    fileCheckpointCount > 0 && Boolean(onOpenFileCheckpoints);
  const reasoningStatus = harnessState.reasoning?.reasoning;
  const reasoningRunStatus = reasoningStatus?.status;
  const hasReasoningSignal =
    reasoningStatus?.supported === true &&
    ((typeof reasoningRunStatus === "string" &&
      reasoningRunStatus !== "idle") ||
      Boolean(reasoningStatus.text?.trim()));
  const runtimeTeamCounts = useMemo(
    () => summarizeRuntimeTeamStatus(canonicalChildren),
    [canonicalChildren],
  );
  const hasCanonicalSubagents = runtimeTeamCounts.total > 0;
  const canonicalSubagentsLabel = translate(
    "agentChat.runtimeStrip.team.badgeRoleCount",
    { count: runtimeTeamCounts.total },
  );
  const canonicalSubagentsSummary = hasCanonicalSubagents
    ? translate("agentChat.runtimeStrip.team.configuredSummary", {
        count: runtimeTeamCounts.total,
      })
    : translate("agentChat.runtimeStrip.team.defaultSummary");
  const runtimeStripCollaboration = useMemo(() => {
    const totalTeamSessions = runtimeTeamCounts.total;
    const delegatedTaskCount = harnessState.delegatedTasks.length;
    if (
      !toolPreferences.subagent &&
      totalTeamSessions === 0 &&
      delegatedTaskCount === 0
    ) {
      return null;
    }
    const phase =
      runtimeTeamCounts.active > 0
        ? "acting"
        : totalTeamSessions > 0 || delegatedTaskCount > 0
          ? "completed"
          : "configured";
    return buildAgentUiCollaborationPayloadMetadata({
      sourceType: "runtime_strip",
      surface: "runtime_strip",
      phase,
      status: phase,
      runtimeEntity: "subagent_turn",
      collaborationKind: "team_runtime_status",
      payload: {
        collaborationFacts: {
          source: "runtime_strip",
          surface: "runtime_strip",
          collaborationSurface: "runtime_strip",
          collaborationPhase: phase,
          collaborationKind: "team_runtime_status",
          status: phase,
          runtimeEntity: "subagent_turn",
          rosterSource: runtimeTeamCounts.source,
          activeCount: runtimeTeamCounts.active,
          pendingInitCount: runtimeTeamCounts.pendingInit,
          runningCount: runtimeTeamCounts.running,
          queuedCount: runtimeTeamCounts.queued,
          interruptedCount: runtimeTeamCounts.interrupted,
          completedCount: runtimeTeamCounts.completed,
          erroredCount: runtimeTeamCounts.errored,
          shutdownCount: runtimeTeamCounts.shutdown,
          notFoundCount: runtimeTeamCounts.notFound,
          totalCount: totalTeamSessions,
          delegatedTaskCount,
        },
      },
    });
  }, [
    harnessState.delegatedTasks.length,
    runtimeTeamCounts,
    toolPreferences.subagent,
  ]);
  const runtimeStripCollaborationFacts =
    runtimeStripCollaboration?.collaborationFacts;

  const capabilities = useMemo<CapabilityItem[]>(
    () => [
      {
        key: "direct",
        label: translate("agentChat.runtimeStrip.capability.direct"),
        enabled: true,
      },
      {
        key: "thinking",
        label: translate("agentChat.runtimeStrip.capability.thinking"),
        enabled: true,
      },
      {
        key: "web_search",
        label: translate("agentChat.runtimeStrip.capability.webSearch"),
        enabled: runtimeToolAvailability?.webSearch !== false,
      },
      {
        key: "subagent",
        label: translate("agentChat.runtimeStrip.capability.subagent"),
        enabled:
          toolPreferences.subagent &&
          runtimeToolAvailability?.subagentRuntime !== false,
      },
    ],
    [
      runtimeToolAvailability?.subagentRuntime,
      runtimeToolAvailability?.webSearch,
      translate,
      toolPreferences,
    ],
  );

  const statusItems = useMemo<StatusItem[]>(() => {
    const nextItems: StatusItem[] = [];
    const outputSchemaLabel = getOutputSchemaRuntimeLabel(
      executionRuntime?.output_schema_runtime,
    );
    if (hasRuntimeWorkbenchSignals) {
      nextItems.push({
        key: "runtime_outputs",
        label: translate("agentChat.runtimeStrip.status.runtimeOutputs", {
          count:
            harnessState.outputSignals.length ||
            harnessState.activeFileWrites.length ||
            harnessState.recentFileEvents.length,
        }),
        tone: "outline",
      });

      if (fileCheckpointCount > 0) {
        nextItems.push({
          key: "runtime_file_changes",
          label: translate("agentChat.runtimeStrip.status.runtimeFileChanges", {
            count: fileCheckpointCount,
          }),
          tone: "outline",
        });
      }
    }

    if (isSending) {
      nextItems.push({
        key: "sending",
        label:
          runtimeStatusTitle ||
          translate("agentChat.runtimeStrip.status.preparing"),
        tone: "secondary",
      });
    }

    if (hasReasoningSignal) {
      nextItems.push({
        key: "reasoning",
        label: translate("agentChat.runtimeStrip.capability.thinking"),
        tone: reasoningRunStatus === "running" ? "secondary" : "outline",
      });
    }

    if (outputSchemaLabel) {
      nextItems.push({
        key: "output_schema_runtime",
        label: translate("agentChat.runtimeStrip.status.outputSchema", {
          label: outputSchemaLabel,
        }),
        tone: isSending ? "secondary" : "outline",
      });
    }

    if (runtimeToolAvailability?.known) {
      nextItems.push({
        key: "runtime_surface",
        label: translate("agentChat.runtimeStrip.status.runtimeSurface", {
          count: runtimeToolAvailability.availableToolCount,
        }),
        tone: "outline",
      });

      if (!runtimeToolAvailability.planRuntime) {
        nextItems.push({
          key: "plan_runtime_gap",
          label: translate("agentChat.runtimeStrip.status.planToolGap", {
            count: runtimeToolAvailability.missingPlanTools.length,
          }),
          tone: "outline",
        });
      }

      if (!runtimeToolAvailability.webSearch) {
        nextItems.push({
          key: "web_search_gap",
          label: translate("agentChat.runtimeStrip.status.webSearchGap"),
          tone: "secondary",
        });
      }

      if (
        toolPreferences.subagent &&
        !runtimeToolAvailability.subagentRuntime
      ) {
        nextItems.push({
          key: "subagent_tool_gap",
          label: translate("agentChat.runtimeStrip.status.subagentToolGap", {
            count: [
              ...runtimeToolAvailability.missingSubagentCoreTools,
              ...runtimeToolAvailability.missingSubagentTeamTools,
            ].length,
          }),
          tone: "secondary",
        });
      }
    }

    if (harnessState.plan.phase === "planning") {
      nextItems.push({
        key: "planning",
        label: translate("agentChat.runtimeStrip.status.planning"),
        tone: "secondary",
      });
    }

    if (harnessState.plan.items.length > 0) {
      nextItems.push({
        key: "plan_items",
        label: translate("agentChat.runtimeStrip.status.planItems", {
          count: harnessState.plan.items.length,
        }),
        tone: "outline",
      });
    }

    if (harnessState.pendingApprovals.length > 0) {
      nextItems.push({
        key: "pending",
        label: translate("agentChat.runtimeStrip.status.pending", {
          count: harnessState.pendingApprovals.length,
        }),
        tone: "secondary",
      });
    }

    if (runtimeTeamCounts.active > 0) {
      nextItems.push({
        key: "team_running",
        label:
          runtimeTeamCounts.queued > 0
            ? translate("agentChat.runtimeStrip.status.teamRunningQueued", {
                active: runtimeTeamCounts.active,
                total: runtimeTeamCounts.total,
                queued: runtimeTeamCounts.queued,
              })
            : translate("agentChat.runtimeStrip.status.teamRunning", {
                active: runtimeTeamCounts.active,
                total: runtimeTeamCounts.total,
              }),
        tone: "secondary",
      });
    } else if (runtimeTeamCounts.total > 0) {
      nextItems.push({
        key: "team_sessions",
        label:
          runtimeTeamCounts.completed > 0
            ? translate("agentChat.runtimeStrip.status.teamCompleted", {
                total: runtimeTeamCounts.total,
                completed: runtimeTeamCounts.completed,
              })
            : translate("agentChat.runtimeStrip.status.teamSessions", {
                total: runtimeTeamCounts.total,
              }),
        tone: "outline",
      });
    } else if (harnessState.delegatedTasks.length > 0) {
      nextItems.push({
        key: "delegated",
        label: translate("agentChat.runtimeStrip.status.delegated", {
          count: harnessState.delegatedTasks.length,
        }),
        tone: "outline",
      });
    }

    if (runtimeTeamCounts.interrupted > 0) {
      nextItems.push({
        key: "team_interrupted",
        label: `${translate("agentChat.collaboration.status.interrupted")} ${runtimeTeamCounts.interrupted}`,
        tone: "outline",
      });
    }

    if (harnessState.outputSignals.length > 0) {
      nextItems.push({
        key: "outputs",
        label: translate("agentChat.runtimeStrip.status.outputs", {
          count: harnessState.outputSignals.length,
        }),
        tone: "outline",
      });
    }

    if (nextItems.length === 0) {
      nextItems.push({
        key: "default_mode",
        label: translate("agentChat.runtimeStrip.status.defaultMode"),
        tone: "outline",
      });
    }

    return nextItems;
  }, [
    executionRuntime,
    fileCheckpointCount,
    harnessState,
    hasRuntimeWorkbenchSignals,
    hasReasoningSignal,
    isSending,
    reasoningRunStatus,
    runtimeTeamCounts,
    runtimeToolAvailability,
    runtimeStatusTitle,
    translate,
    toolPreferences.subagent,
  ]);

  return (
    <div
      data-testid="agent-runtime-strip"
      data-runtime-kind={hasRuntimeWorkbenchSignals ? "runtime" : "general"}
      data-execution-strategy={executionRuntime?.execution_strategy ?? ""}
      data-team-roster-source={runtimeTeamCounts.source}
      data-team-total-count={runtimeTeamCounts.total}
      data-team-active-count={runtimeTeamCounts.active}
      data-team-pending-init-count={runtimeTeamCounts.pendingInit}
      data-team-running-count={runtimeTeamCounts.running}
      data-team-queued-count={runtimeTeamCounts.queued}
      data-team-interrupted-count={runtimeTeamCounts.interrupted}
      data-team-completed-count={runtimeTeamCounts.completed}
      data-team-errored-count={runtimeTeamCounts.errored}
      data-team-shutdown-count={runtimeTeamCounts.shutdown}
      data-team-not-found-count={runtimeTeamCounts.notFound}
      data-collaboration-facts={
        runtimeStripCollaborationFacts ? "yes" : undefined
      }
      data-collaboration-surface={
        runtimeStripCollaboration?.collaborationSurface
      }
      data-collaboration-phase={runtimeStripCollaboration?.collaborationPhase}
      data-collaboration-kind={readFactString(
        runtimeStripCollaborationFacts,
        "collaborationKind",
      )}





      className={
        variant === "embedded"
          ? "rounded-xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
          : "mx-3 mb-2 mt-3 rounded-2xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div
          className="text-sm font-medium text-foreground"
          data-testid="agent-runtime-strip-title"
        >
          {stripTitle}
        </div>
        <Badge variant="outline">{themeLabel}</Badge>
        {toolPreferences.subagent ? (
          <Badge variant={hasCanonicalSubagents ? "secondary" : "outline"}>
            {hasCanonicalSubagents
              ? translate("agentChat.runtimeStrip.team.badgeConfigured", {
                  label: canonicalSubagentsLabel,
                })
              : translate("agentChat.runtimeStrip.team.badgeEnabled")}
          </Badge>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {capabilities.map((item) => (
          <span
            key={item.key}
            data-testid={`agent-runtime-strip-capability-${item.key}`}
            data-capability-key={item.key}
            data-enabled={String(item.enabled)}
            className={[
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              item.enabled
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/70 bg-background/80 text-muted-foreground",
            ].join(" ")}
          >
            {item.label}
          </span>
        ))}
      </div>
      {toolPreferences.subagent ? (
        <div
          className="mb-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground"
          data-testid="agent-runtime-strip-team-summary"
          data-collaboration-facts={
            runtimeStripCollaborationFacts ? "yes" : undefined
          }
          data-collaboration-surface={
            runtimeStripCollaboration?.collaborationSurface
          }
          data-collaboration-phase={
            runtimeStripCollaboration?.collaborationPhase
          }
          data-collaboration-kind={readFactString(
            runtimeStripCollaborationFacts,
            "collaborationKind",
          )}


        >
          <span className="font-medium text-foreground">
            {translate("agentChat.runtimeStrip.team.title")}
          </span>
          <span> · {canonicalSubagentsSummary}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {statusItems.map((item) => (
          <Badge
            key={item.key}
            variant={item.tone || "outline"}
            data-testid={`agent-runtime-strip-status-${item.key}`}
            data-status-key={item.key}
          >
            {item.label}
          </Badge>
        ))}
        {canReviewFileCheckpoints ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full border-sky-200 bg-white px-2.5 text-xs text-sky-700 hover:bg-sky-50 dark:bg-background"
            onClick={onOpenFileCheckpoints}
            aria-label={translate(
              "agentChat.runtimeStrip.action.reviewFileChangesAria",
            )}
            title={translate(
              "agentChat.runtimeStrip.action.reviewFileChangesAria",
            )}
            data-testid="agent-runtime-strip-open-file-checkpoints"
          >
            <GitCompare className="mr-1.5 h-3.5 w-3.5" />
            {translate("agentChat.runtimeStrip.action.reviewFileChanges")}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
