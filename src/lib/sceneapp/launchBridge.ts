import type { AutomationJobDialogInitialValues } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import {
  createSceneAppAutomationJob,
  type SceneAppAutomationResult,
} from "@/lib/api/sceneapp";
import {
  buildSceneAppExecutionDraft,
  type SceneAppAutomationExecutionDraft,
  type SceneAppWorkspaceExecutionDraft,
} from "./launch";
import type { SceneAppAutomationIntent, SceneAppPlanResult } from "./types";
import type { Page, PageParams } from "@/types/page";
import type { CreationMode } from "@/components/agent/chat/components/types";
import type { ChatToolPreferences } from "@/components/agent/chat/utils/chatToolPreferences";
import { resolveWorkspaceEntry } from "@/components/agent/chat/workspaceEntry";

type ResolvedWorkspaceEntryOk = Extract<
  ReturnType<typeof resolveWorkspaceEntry>,
  { ok: true }
>;

export type SceneAppLaunchFailureReason =
  | "missing_project"
  | "empty_payload"
  | "missing_navigate";

export interface ResolveSceneAppLaunchActionOptions {
  planResult: SceneAppPlanResult;
  projectId?: string | null;
  activeTheme: string;
  creationMode: CreationMode;
  defaultToolPreferences: ChatToolPreferences;
  now?: () => number;
}

export type ResolvedSceneAppLaunchAction =
  | {
      ok: true;
      kind: "navigate_agent";
      executionDraft: SceneAppWorkspaceExecutionDraft;
      resolvedEntry: ResolvedWorkspaceEntryOk;
    }
  | {
      ok: true;
      kind: "automation_job";
      executionDraft: SceneAppAutomationExecutionDraft;
    }
  | {
      ok: false;
      kind: "workspace_entry";
      executionDraft: SceneAppWorkspaceExecutionDraft;
      reason: SceneAppLaunchFailureReason;
      message: string;
    };

export interface ExecuteSceneAppLaunchActionOptions extends ResolveSceneAppLaunchActionOptions {
  onNavigate?: (page: Page, params?: PageParams) => void;
  onOpenAutomationDialog?: (payload: {
    initialValues: AutomationJobDialogInitialValues;
    automationIntent: SceneAppAutomationIntent;
    executionDraft: SceneAppAutomationExecutionDraft;
  }) => void;
  createAutomationJob?: (
    intent: SceneAppAutomationIntent,
  ) => Promise<SceneAppAutomationResult>;
}

export type ExecutedSceneAppLaunchAction =
  | {
      ok: true;
      kind: "navigate_agent";
      executionDraft: SceneAppWorkspaceExecutionDraft;
      resolvedEntry: ResolvedWorkspaceEntryOk;
    }
  | {
      ok: true;
      kind: "open_automation_dialog";
      executionDraft: SceneAppAutomationExecutionDraft;
    }
  | {
      ok: true;
      kind: "automation_job_created";
      executionDraft: SceneAppAutomationExecutionDraft;
      result: SceneAppAutomationResult;
    }
  | {
      ok: false;
      kind: "workspace_entry";
      executionDraft: SceneAppWorkspaceExecutionDraft;
      reason: SceneAppLaunchFailureReason;
      message: string;
    };

function buildSceneAppLaunchFailureMessage(params: {
  title: string;
  reason: Extract<
    SceneAppLaunchFailureReason,
    "missing_project" | "empty_payload"
  >;
}): string {
  if (params.reason === "missing_project") {
    return `Skill「${params.title}」需要项目工作区，请先选择项目后再启动。`;
  }

  return `Skill「${params.title}」缺少可执行内容，请先补齐输入或参数。`;
}

export function resolveSceneAppLaunchAction(
  options: ResolveSceneAppLaunchActionOptions,
): ResolvedSceneAppLaunchAction {
  const executionDraft = buildSceneAppExecutionDraft(options.planResult);

  if (executionDraft.kind === "automation_job") {
    return {
      ok: true,
      kind: "automation_job",
      executionDraft,
    };
  }

  const resolvedEntry = resolveWorkspaceEntry({
    projectId: options.projectId ?? null,
    activeTheme: options.activeTheme,
    creationMode: options.creationMode,
    defaultToolPreferences: options.defaultToolPreferences,
    payload: executionDraft.workspaceEntry,
    now: options.now,
  });

  if (!resolvedEntry.ok) {
    return {
      ok: false,
      kind: "workspace_entry",
      executionDraft,
      reason: resolvedEntry.reason,
      message: buildSceneAppLaunchFailureMessage({
        title: executionDraft.targetLabel,
        reason: resolvedEntry.reason,
      }),
    };
  }

  return {
    ok: true,
    kind: "navigate_agent",
    executionDraft,
    resolvedEntry,
  };
}

export async function executeSceneAppLaunchAction(
  options: ExecuteSceneAppLaunchActionOptions,
): Promise<ExecutedSceneAppLaunchAction> {
  const resolvedAction = resolveSceneAppLaunchAction(options);

  if (!resolvedAction.ok) {
    return resolvedAction;
  }

  if (resolvedAction.kind === "navigate_agent") {
    if (!options.onNavigate) {
      return {
        ok: false,
        kind: "workspace_entry",
        executionDraft: resolvedAction.executionDraft,
        reason: "missing_navigate",
        message: "当前入口暂不支持切换到 Skills 工作区，请从桌面主界面重试。",
      };
    }

    options.onNavigate("agent", resolvedAction.resolvedEntry.navigationParams);
    return resolvedAction;
  }

  if (options.onOpenAutomationDialog) {
    options.onOpenAutomationDialog({
      initialValues:
        resolvedAction.executionDraft.automationDialogInitialValues,
      automationIntent: resolvedAction.executionDraft.automationIntent,
      executionDraft: resolvedAction.executionDraft,
    });

    return {
      ok: true,
      kind: "open_automation_dialog",
      executionDraft: resolvedAction.executionDraft,
    };
  }

  const createAutomationJob =
    options.createAutomationJob ?? createSceneAppAutomationJob;
  const result = await createAutomationJob(
    resolvedAction.executionDraft.automationIntent,
  );

  return {
    ok: true,
    kind: "automation_job_created",
    executionDraft: resolvedAction.executionDraft,
    result,
  };
}
