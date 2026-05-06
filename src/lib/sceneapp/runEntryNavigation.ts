import type {
  AgentPageParams,
  AgentPendingServiceSkillLaunchParams,
  AutomationPageParams,
  BrowserRuntimePageParams,
  Page,
  PageParams,
} from "@/types/page";
import type { SceneAppRunDetailViewModel } from "./product";
import type {
  SceneAppServiceSceneRuntimeRef,
  SceneAppNativeSkillRuntimeRef,
} from "./types";

export interface SceneAppRunEntryNavigationTarget {
  page: Page;
  params: PageParams;
}

export interface ResolveSceneAppRunEntryNavigationTargetParams {
  action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>;
  sceneappId: string;
  sceneTitle?: string | null;
  sourceLabel: string;
  projectId?: string | null;
  linkedServiceSkillId?: string | null;
  linkedSceneKey?: string | null;
}

export function normalizeSceneAppSlotValues(
  slots?: Record<string, string>,
): Record<string, string> | undefined {
  if (!slots) {
    return undefined;
  }

  const normalizedEntries = Object.entries(slots)
    .map(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) {
        return null;
      }

      return [normalizedKey, normalizedValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

export function buildServiceSceneResumeRequestMetadata(params: {
  sceneappId: string;
  runtimeRef: SceneAppServiceSceneRuntimeRef;
}): Record<string, unknown> {
  return {
    sceneapp: {
      id: params.sceneappId,
    },
    harness: {
      service_scene_launch: {
        kind: "local_service_skill",
        service_scene_run: {
          sceneapp_id: params.sceneappId,
          scene_key: params.runtimeRef.sceneKey ?? null,
          skill_id: params.runtimeRef.skillId ?? null,
          linked_skill_id: params.runtimeRef.skillId ?? null,
          execution_location: "client_default",
          project_id: params.runtimeRef.projectId ?? null,
          content_id: params.runtimeRef.contentId ?? null,
          workspace_id: params.runtimeRef.workspaceId ?? null,
          entry_source:
            params.runtimeRef.entrySource?.trim() || "sceneapp_run_resume",
          user_input: params.runtimeRef.userInput ?? null,
          slots: normalizeSceneAppSlotValues(params.runtimeRef.slots) ?? {},
        },
      },
    },
  };
}

export function buildServiceSceneResumePrompt(params: {
  title: string;
  runtimeRef: SceneAppServiceSceneRuntimeRef;
}): string {
  const userInput = params.runtimeRef.userInput?.trim();
  if (userInput) {
    return userInput;
  }

  const slotSummary = Object.entries(
    normalizeSceneAppSlotValues(params.runtimeRef.slots) ?? {},
  )
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`)
    .join("；");

  if (slotSummary) {
    return `请继续执行 Skill「${params.title}」。Skill 参数：${slotSummary}。`;
  }

  return `请继续执行 Skill「${params.title}」，并按最近一次场景执行上下文继续。`;
}

export function buildNativeSkillResumeRequestMetadata(params: {
  sceneappId: string;
  runtimeRef: SceneAppNativeSkillRuntimeRef;
}): Record<string, unknown> | undefined {
  const slots = normalizeSceneAppSlotValues(params.runtimeRef.slots);
  const hasPayload =
    Boolean(params.runtimeRef.skillId?.trim()) ||
    Boolean(params.runtimeRef.skillKey?.trim()) ||
    Boolean(params.runtimeRef.projectId?.trim()) ||
    Boolean(params.runtimeRef.workspaceId?.trim()) ||
    Boolean(params.runtimeRef.userInput?.trim()) ||
    Boolean(slots);

  if (!hasPayload) {
    return undefined;
  }

  return {
    sceneapp: {
      id: params.sceneappId,
    },
    harness: {
      sceneapp_native_skill_launch: {
        skill_id: params.runtimeRef.skillId ?? null,
        skill_key: params.runtimeRef.skillKey ?? null,
        project_id: params.runtimeRef.projectId ?? null,
        workspace_id: params.runtimeRef.workspaceId ?? null,
        user_input: params.runtimeRef.userInput ?? null,
        slots: slots ?? {},
      },
    },
  };
}

function buildEntryBannerMessage(sourceLabel: string, suffix: string): string {
  return `已从${sourceLabel}恢复${suffix}。`;
}

function buildNativeSkillLaunchParams(params: {
  runtimeRef: SceneAppNativeSkillRuntimeRef;
  sourceLabel: string;
  linkedServiceSkillId?: string | null;
  linkedSceneKey?: string | null;
}): AgentPendingServiceSkillLaunchParams | null {
  const skillId =
    params.runtimeRef.skillId ??
    params.runtimeRef.skillKey ??
    params.linkedServiceSkillId ??
    params.linkedSceneKey ??
    "";
  const normalizedSkillId = skillId.trim();
  if (!normalizedSkillId) {
    return null;
  }

  return {
    skillId: normalizedSkillId,
    skillKey:
      params.runtimeRef.skillKey?.trim() ||
      params.linkedSceneKey?.trim() ||
      undefined,
    requestKey: Date.now(),
    initialSlotValues:
      normalizeSceneAppSlotValues(params.runtimeRef.slots) ?? undefined,
    prefillHint: `已从${params.sourceLabel}恢复技能补参。`,
    launchUserInput: params.runtimeRef.userInput ?? undefined,
  };
}

export function resolveSceneAppRunEntryNavigationTarget(
  params: ResolveSceneAppRunEntryNavigationTargetParams,
): SceneAppRunEntryNavigationTarget | null {
  const normalizedSceneAppId = params.sceneappId.trim();
  if (!normalizedSceneAppId) {
    return null;
  }

  const sourceLabel = params.sourceLabel.trim() || "Skill";

  if (params.action.kind === "open_automation_job") {
    const targetParams: AutomationPageParams = {
      selectedJobId: params.action.jobId,
      workspaceTab: "tasks",
    };
    return {
      page: "automation",
      params: targetParams,
    };
  }

  if (params.action.kind === "open_agent_session") {
    const targetParams: AgentPageParams = {
      agentEntry: "claw",
      initialSessionId: params.action.sessionId,
      entryBannerMessage: buildEntryBannerMessage(
        sourceLabel,
        "对应 Agent 会话",
      ),
    };
    return {
      page: "agent",
      params: targetParams,
    };
  }

  if (params.action.kind === "open_browser_runtime") {
    const targetParams: BrowserRuntimePageParams = {
      initialProfileKey:
        params.action.browserRuntimeRef.profileKey ?? undefined,
      initialSessionId: params.action.browserRuntimeRef.sessionId ?? undefined,
      initialTargetId: params.action.browserRuntimeRef.targetId ?? undefined,
    };
    return {
      page: "browser-runtime",
      params: targetParams,
    };
  }

  if (params.action.kind === "open_service_scene_session") {
    if (params.action.sessionId) {
      const targetParams: AgentPageParams = {
        agentEntry: "claw",
        initialSessionId: params.action.sessionId,
        entryBannerMessage: buildEntryBannerMessage(sourceLabel, "生成会话"),
      };
      return {
        page: "agent",
        params: targetParams,
      };
    }

    const targetParams: AgentPageParams = {
      agentEntry: "claw",
      projectId: params.action.serviceSceneRuntimeRef.projectId ?? undefined,
      contentId: params.action.serviceSceneRuntimeRef.contentId ?? undefined,
      initialUserPrompt: buildServiceSceneResumePrompt({
        title: params.sceneTitle?.trim() || "这个 Skill",
        runtimeRef: params.action.serviceSceneRuntimeRef,
      }),
      initialAutoSendRequestMetadata: buildServiceSceneResumeRequestMetadata({
        sceneappId: normalizedSceneAppId,
        runtimeRef: params.action.serviceSceneRuntimeRef,
      }),
      autoRunInitialPromptOnMount: true,
      entryBannerMessage: buildEntryBannerMessage(sourceLabel, "生成上下文"),
    };
    return {
      page: "agent",
      params: targetParams,
    };
  }

  if (params.action.kind === "open_native_skill_session") {
    if (params.action.sessionId) {
      const targetParams: AgentPageParams = {
        agentEntry: "claw",
        initialSessionId: params.action.sessionId,
        entryBannerMessage: buildEntryBannerMessage(
          sourceLabel,
          "本机技能会话",
        ),
      };
      return {
        page: "agent",
        params: targetParams,
      };
    }

    const initialPendingServiceSkillLaunch = buildNativeSkillLaunchParams({
      runtimeRef: params.action.nativeSkillRuntimeRef,
      sourceLabel,
      linkedServiceSkillId: params.linkedServiceSkillId,
      linkedSceneKey: params.linkedSceneKey,
    });
    if (!initialPendingServiceSkillLaunch) {
      return null;
    }

    const targetParams: AgentPageParams = {
      agentEntry: "claw",
      projectId:
        params.action.nativeSkillRuntimeRef.projectId ??
        params.projectId ??
        undefined,
      initialRequestMetadata: buildNativeSkillResumeRequestMetadata({
        sceneappId: normalizedSceneAppId,
        runtimeRef: params.action.nativeSkillRuntimeRef,
      }),
      initialPendingServiceSkillLaunch,
      entryBannerMessage: buildEntryBannerMessage(sourceLabel, "本机技能入口"),
    };
    return {
      page: "agent",
      params: targetParams,
    };
  }

  return null;
}
