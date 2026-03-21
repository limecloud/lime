import { safeInvoke } from "@/lib/dev-bridge";

export type ClawSolutionReadiness =
  | "ready"
  | "needs_setup"
  | "needs_capability";

export type ClawSolutionActionType =
  | "fill_input"
  | "navigate_theme"
  | "launch_browser_assist"
  | "enable_team_mode";

export type ClawSolutionReasonCode =
  | "missing_model"
  | "missing_browser_capability"
  | "missing_skill_dependency"
  | "team_recommended";

export interface ClawSolutionSummary {
  id: string;
  title: string;
  summary: string;
  outputHint: string;
  recommendedCapabilities: string[];
  readiness: ClawSolutionReadiness;
  readinessMessage: string;
  reasonCode?: ClawSolutionReasonCode;
}

export interface ClawSolutionDetail extends ClawSolutionSummary {
  starterPrompt: string;
  themeTarget?: string;
  followupMode?: string;
  capabilityTags: string[];
}

export interface ClawSolutionContext {
  projectId?: string;
  userInput?: string;
}

export interface ClawSolutionReadinessResult {
  solutionId: string;
  readiness: ClawSolutionReadiness;
  readinessMessage: string;
  reasonCode?: ClawSolutionReasonCode;
}

export interface ClawSolutionPreparation {
  solutionId: string;
  actionType: ClawSolutionActionType;
  prompt: string;
  themeTarget?: string;
  shouldLaunchBrowserAssist: boolean;
  shouldEnableTeamMode: boolean;
  readiness: ClawSolutionReadiness;
  readinessMessage: string;
  reasonCode?: ClawSolutionReasonCode;
}

export async function listClawSolutions(): Promise<ClawSolutionSummary[]> {
  return safeInvoke("claw_solution_list");
}

export async function getClawSolutionDetail(
  solutionId: string,
): Promise<ClawSolutionDetail> {
  return safeInvoke("claw_solution_detail", { solutionId });
}

export async function checkClawSolutionReadiness(
  solutionId: string,
  context?: ClawSolutionContext,
): Promise<ClawSolutionReadinessResult> {
  return safeInvoke("claw_solution_check_readiness", { solutionId, context });
}

export async function prepareClawSolution(
  solutionId: string,
  context?: ClawSolutionContext,
): Promise<ClawSolutionPreparation> {
  return safeInvoke("claw_solution_prepare", { solutionId, context });
}
