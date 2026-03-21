import type {
  ClawSolutionActionType,
  ClawSolutionDetail,
  ClawSolutionPreparation,
  ClawSolutionReadiness,
  ClawSolutionReadinessResult,
  ClawSolutionReasonCode,
  ClawSolutionSummary,
} from "@/lib/api/clawSolutions";

export type {
  ClawSolutionActionType,
  ClawSolutionDetail,
  ClawSolutionPreparation,
  ClawSolutionReadiness,
  ClawSolutionReadinessResult,
  ClawSolutionReasonCode,
  ClawSolutionSummary,
};

export type ClawSolutionTone = "slate" | "sky" | "emerald" | "amber";

export interface ClawSolutionHomeItem extends ClawSolutionSummary {
  badge: string;
  recentUsedAt: number | null;
  isRecent: boolean;
  readinessLabel: string;
  readinessTone: ClawSolutionTone;
}

export interface ClawSolutionUsageRecord {
  solutionId: string;
  usedAt: number;
  actionType?: ClawSolutionActionType;
  themeTarget?: string | null;
}

export interface RecordClawSolutionUsageInput {
  solutionId: string;
  usedAt?: number;
  actionType?: ClawSolutionActionType;
  themeTarget?: string | null;
}
