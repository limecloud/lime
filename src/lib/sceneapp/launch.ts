import type { AutomationJobDialogInitialValues } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type {
  AutomationExecutionMode,
  AutomationJobRequest,
  DeliveryConfig,
  TaskSchedule,
} from "@/lib/api/automation";
import type { AgentPendingServiceSkillLaunchParams } from "@/types/page";
import type {
  SceneAppAutomationIntent,
  SceneAppPlanResult,
  SceneAppRuntimeAdapterPlan,
} from "./types";
import {
  buildSceneAppExecutionSummaryViewModel,
  type SceneAppExecutionSummaryViewModel,
} from "./product";

type SceneAppWorkspaceRuntimeAction = Exclude<
  SceneAppRuntimeAdapterPlan["runtimeAction"],
  "create_automation_job"
>;

export interface SceneAppWorkspaceEntryDraft {
  prompt?: string;
  projectId?: string;
  contentId?: string;
  initialSceneAppExecutionSummary?: SceneAppExecutionSummaryViewModel;
  initialRequestMetadata?: Record<string, unknown>;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  initialPendingServiceSkillLaunch?: AgentPendingServiceSkillLaunchParams;
  autoRunInitialPromptOnMount?: boolean;
  openBrowserAssistOnMount?: boolean;
  themeOverride?: string;
  lockTheme?: boolean;
}

export interface SceneAppWorkspaceExecutionDraft {
  kind: "workspace_entry";
  sceneappId: string;
  runtimeAction: SceneAppWorkspaceRuntimeAction;
  adapterKind: SceneAppRuntimeAdapterPlan["adapterKind"];
  targetRef: string;
  targetLabel: string;
  workspaceId?: string;
  requestMetadata: Record<string, unknown>;
  workspaceEntry: SceneAppWorkspaceEntryDraft;
  notes: string[];
}

export interface SceneAppAutomationExecutionDraft {
  kind: "automation_job";
  sceneappId: string;
  runtimeAction: "create_automation_job";
  adapterKind: "automation_job";
  targetRef: string;
  targetLabel: string;
  automationIntent: SceneAppAutomationIntent;
  automationRequest: AutomationJobRequest;
  automationDialogInitialValues: AutomationJobDialogInitialValues;
  notes: string[];
}

export type SceneAppExecutionDraft =
  | SceneAppWorkspaceExecutionDraft
  | SceneAppAutomationExecutionDraft;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readValue(
  source: Record<string, unknown> | undefined,
  keys: string[],
): unknown {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }

  return undefined;
}

function readText(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  const value = readValue(source, keys);
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): boolean | undefined {
  const value = readValue(source, keys);
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  const value = readValue(source, keys);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readRecord(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): Record<string, unknown> | undefined {
  return asRecord(readValue(source, keys));
}

function readStringRecord(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): Record<string, string> | undefined {
  const record = readRecord(source, ...keys);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length !== Object.keys(record).length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function readStringArray(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): string[] | undefined {
  const value = readValue(source, keys);
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ) as string[];
}

function readLaunchPayload(
  result: SceneAppPlanResult,
): Record<string, unknown> | undefined {
  return asRecord(result.plan.adapterPlan.launchPayload);
}

function readRequestMetadata(
  result: SceneAppPlanResult,
): Record<string, unknown> {
  return asRecord(result.plan.adapterPlan.requestMetadata) ?? {};
}

function normalizeSceneAppNote(note: string): string {
  return note
    .replace(/场景技能主链/g, "Agent 工作区主链")
    .replace(/场景技能入口/g, "Agent 工作区入口");
}

function resolveSceneAppNotes(result: SceneAppPlanResult): string[] {
  return dedupeStrings([
    ...(result.contextOverlay?.compilerPlan.notes ?? []).map(
      normalizeSceneAppNote,
    ),
    ...(result.projectPackPlan?.notes ?? []).map(normalizeSceneAppNote),
    ...result.plan.warnings.map(normalizeSceneAppNote),
    ...result.plan.adapterPlan.notes.map(normalizeSceneAppNote),
    result.readiness.ready ? undefined : "当前做法仍有未满足的启动前置条件。",
  ]);
}

function resolveSceneAppLaunchIntent(
  result: SceneAppPlanResult,
): SceneAppAutomationIntent["launchIntent"] {
  const launchPayload = readLaunchPayload(result);
  const nestedIntent = readRecord(
    launchPayload,
    "launch_intent",
    "launchIntent",
  );

  return {
    sceneappId:
      readText(nestedIntent, "sceneappId", "sceneapp_id") ??
      result.descriptor.id,
    entrySource: readText(nestedIntent, "entrySource", "entry_source"),
    workspaceId: readText(nestedIntent, "workspaceId", "workspace_id"),
    projectId:
      readText(nestedIntent, "projectId", "project_id") ??
      readText(launchPayload, "projectId", "project_id"),
    userInput:
      readText(nestedIntent, "userInput", "user_input") ??
      readText(launchPayload, "message", "userInput", "user_input", "prompt"),
    referenceMemoryIds:
      readStringArray(
        nestedIntent,
        "referenceMemoryIds",
        "reference_memory_ids",
      ) ??
      readStringArray(
        launchPayload,
        "referenceMemoryIds",
        "reference_memory_ids",
      ),
    slots:
      readStringRecord(nestedIntent, "slots") ??
      readStringRecord(launchPayload, "slots"),
    runtimeContext: readRecord(
      nestedIntent,
      "runtimeContext",
      "runtime_context",
    ) as SceneAppAutomationIntent["launchIntent"]["runtimeContext"],
  };
}

function normalizeSchedule(
  scheduleRecord: Record<string, unknown> | undefined,
): TaskSchedule {
  const kind = readText(scheduleRecord, "kind");
  if (kind === "cron") {
    return {
      kind: "cron",
      expr: readText(scheduleRecord, "expr") ?? "0 * * * *",
      tz: readText(scheduleRecord, "tz") ?? "Asia/Shanghai",
    };
  }

  if (kind === "at") {
    return {
      kind: "at",
      at: readText(scheduleRecord, "at") ?? new Date().toISOString(),
    };
  }

  return {
    kind: "every",
    every_secs: readNumber(scheduleRecord, "every_secs", "everySecs") ?? 3600,
  };
}

function normalizeExecutionMode(
  value: string | undefined,
): AutomationExecutionMode {
  if (value === "intelligent" || value === "skill" || value === "log_only") {
    return value;
  }
  return "intelligent";
}

function normalizeDeliveryConfig(
  deliveryRecord: Record<string, unknown> | undefined,
): DeliveryConfig {
  const mode = readText(deliveryRecord, "mode");
  if (mode !== "announce") {
    return {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    };
  }

  const channel = readText(deliveryRecord, "channel");
  return {
    mode: "announce",
    channel: channel ?? "webhook",
    target: readText(deliveryRecord, "target") ?? null,
    best_effort:
      readBoolean(deliveryRecord, "best_effort", "bestEffort") ?? true,
    output_schema:
      readText(deliveryRecord, "output_schema", "outputSchema") === "json"
        ? "json"
        : readText(deliveryRecord, "output_schema", "outputSchema") === "table"
          ? "table"
          : readText(deliveryRecord, "output_schema", "outputSchema") === "csv"
            ? "csv"
            : readText(deliveryRecord, "output_schema", "outputSchema") ===
                "links"
              ? "links"
              : "text",
    output_format:
      readText(deliveryRecord, "output_format", "outputFormat") === "json"
        ? "json"
        : "text",
  };
}

function buildSceneAppIntentSummary(
  result: SceneAppPlanResult,
  source: Record<string, unknown> | undefined,
): string | undefined {
  const directInput = readText(
    source,
    "message",
    "prompt",
    "user_input",
    "userInput",
  );
  if (directInput) {
    return directInput;
  }

  const args = readRecord(source, "args");
  const url = readText(args, "url");
  const targetLanguage = readText(args, "target_language", "targetLanguage");
  const slotValues = readRecord(source, "slots");
  const slotSummary = slotValues
    ? Object.entries(slotValues)
        .map(([key, value]) => {
          const normalizedValue =
            typeof value === "string"
              ? value.trim()
              : typeof value === "number" || typeof value === "boolean"
                ? String(value)
                : "";
          return normalizedValue ? `${key}: ${normalizedValue}` : null;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 3)
    : [];

  if (url) {
    return targetLanguage
      ? `目标链接：${url}；目标语言：${targetLanguage}`
      : `目标链接：${url}`;
  }

  if (slotSummary.length > 0) {
    return `场景参数：${slotSummary.join("；")}`;
  }

  return result.descriptor.summary.trim() || undefined;
}

function buildWorkspacePrompt(result: SceneAppPlanResult): string {
  const launchPayload = readLaunchPayload(result);
  const runtimeAction = result.plan.adapterPlan.runtimeAction;
  const directInput = readText(
    launchPayload,
    "message",
    "prompt",
    "user_input",
    "userInput",
  );
  const summary = buildSceneAppIntentSummary(result, launchPayload);

  if (runtimeAction === "launch_browser_assist") {
    return summary
      ? `请执行做法「${result.descriptor.title}」。${summary}。`
      : `请执行做法「${result.descriptor.title}」，并复用当前浏览器上下文完成任务。`;
  }

  if (runtimeAction === "open_service_scene_session") {
    if (directInput) {
      return directInput;
    }

    return summary
      ? `请执行做法「${result.descriptor.title}」。${summary}。`
      : `请执行做法「${result.descriptor.title}」，并按当前启动上下文继续在 Agent 工作区推进。`;
  }

  if (runtimeAction === "launch_native_skill") {
    if (directInput) {
      return directInput;
    }

    return summary
      ? `请执行做法「${result.descriptor.title}」。${summary}。`
      : `请执行做法「${result.descriptor.title}」，并把结果回写到当前工作区。`;
  }

  return directInput
    ? directInput
    : (summary ??
        `请继续执行做法「${result.descriptor.title}」，并遵循当前启动上下文。`);
}

function buildAutomationPrompt(result: SceneAppPlanResult): string {
  const intent = resolveSceneAppLaunchIntent(result);
  return intent.userInput
    ? `SceneApp: ${result.descriptor.title}\n用户目标：${intent.userInput}`
    : `SceneApp: ${result.descriptor.title}`;
}

function resolveWorkspaceProjectId(
  launchPayload: Record<string, unknown> | undefined,
): string | undefined {
  return readText(launchPayload, "project_id", "projectId");
}

function resolveWorkspaceContentId(
  requestMetadata: Record<string, unknown>,
  launchPayload: Record<string, unknown> | undefined,
): string | undefined {
  const harness = readRecord(requestMetadata, "harness");
  const serviceSkillLaunch = readRecord(
    harness,
    "service_skill_launch",
    "serviceSkillLaunch",
  );
  const serviceSceneLaunch = readRecord(
    harness,
    "service_scene_launch",
    "serviceSceneLaunch",
  );
  const serviceSceneRun = readRecord(
    serviceSceneLaunch,
    "service_scene_run",
    "serviceSceneRun",
    "request_context",
    "requestContext",
  );

  return (
    readText(launchPayload, "content_id", "contentId") ??
    readText(serviceSkillLaunch, "content_id", "contentId") ??
    readText(serviceSceneRun, "content_id", "contentId")
  );
}

function buildWorkspaceExecutionDraft(
  result: SceneAppPlanResult,
): SceneAppWorkspaceExecutionDraft {
  const requestMetadata = readRequestMetadata(result);
  const launchPayload = readLaunchPayload(result);
  const runtimeAction = result.plan.adapterPlan.runtimeAction;
  if (runtimeAction === "create_automation_job") {
    throw new Error("automation runtimeAction 不应进入 workspace 执行草稿分支");
  }
  const nativeSkillId =
    readText(
      launchPayload,
      "service_skill_id",
      "serviceSkillId",
      "skill_id",
      "skillId",
    ) ??
    readText(readRecord(requestMetadata, "service_skill"), "id") ??
    result.plan.adapterPlan.linkedServiceSkillId ??
    result.plan.adapterPlan.targetRef;
  const nativeSkillLaunchMetadata = readRecord(
    readRecord(requestMetadata, "harness"),
    "sceneapp_native_skill_launch",
    "sceneappNativeSkillLaunch",
  );
  const nativeSkillKey =
    readText(launchPayload, "skill_key", "skillKey") ??
    readText(nativeSkillLaunchMetadata, "skill_key", "skillKey") ??
    result.plan.adapterPlan.linkedSceneKey;
  const nativeSkillSlotValues =
    readStringRecord(launchPayload, "slots") ??
    readStringRecord(requestMetadata, "sceneapp_slots");
  const nativeSkillUserInput = readText(
    launchPayload,
    "user_input",
    "userInput",
    "message",
    "prompt",
  );

  if (runtimeAction === "launch_native_skill") {
    return {
      kind: "workspace_entry",
      sceneappId: result.descriptor.id,
      runtimeAction,
      adapterKind: result.plan.adapterPlan.adapterKind,
      targetRef: result.plan.adapterPlan.targetRef,
      targetLabel: result.plan.adapterPlan.targetLabel,
      workspaceId: readText(launchPayload, "workspace_id", "workspaceId"),
      requestMetadata,
      workspaceEntry: {
        projectId: resolveWorkspaceProjectId(launchPayload),
        contentId: resolveWorkspaceContentId(requestMetadata, launchPayload),
        initialSceneAppExecutionSummary: buildSceneAppExecutionSummaryViewModel(
          {
            descriptor: result.descriptor,
            planResult: result,
          },
        ),
        initialRequestMetadata:
          Object.keys(requestMetadata).length > 0 ? requestMetadata : undefined,
        initialPendingServiceSkillLaunch: nativeSkillId
          ? {
              skillId: nativeSkillId,
              skillKey: nativeSkillKey,
              initialSlotValues: nativeSkillSlotValues,
              launchUserInput: nativeSkillUserInput,
            }
          : undefined,
      },
      notes: resolveSceneAppNotes(result),
    };
  }

  return {
    kind: "workspace_entry",
    sceneappId: result.descriptor.id,
    runtimeAction,
    adapterKind: result.plan.adapterPlan.adapterKind,
    targetRef: result.plan.adapterPlan.targetRef,
    targetLabel: result.plan.adapterPlan.targetLabel,
    workspaceId: readText(launchPayload, "workspace_id", "workspaceId"),
    requestMetadata,
    workspaceEntry: {
      prompt: buildWorkspacePrompt(result),
      projectId: resolveWorkspaceProjectId(launchPayload),
      contentId: resolveWorkspaceContentId(requestMetadata, launchPayload),
      initialSceneAppExecutionSummary: buildSceneAppExecutionSummaryViewModel({
        descriptor: result.descriptor,
        planResult: result,
      }),
      initialAutoSendRequestMetadata:
        Object.keys(requestMetadata).length > 0 ? requestMetadata : undefined,
      autoRunInitialPromptOnMount: true,
      openBrowserAssistOnMount:
        runtimeAction === "launch_browser_assist" ? true : undefined,
      themeOverride:
        runtimeAction === "launch_browser_assist" ? "general" : undefined,
      lockTheme: runtimeAction === "launch_browser_assist" ? true : undefined,
    },
    notes: resolveSceneAppNotes(result),
  };
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function normalizeDialogDeliveryChannel(
  delivery: DeliveryConfig,
): AutomationJobDialogInitialValues["delivery_channel"] {
  if (
    delivery.channel === "telegram" ||
    delivery.channel === "local_file" ||
    delivery.channel === "google_sheets"
  ) {
    return delivery.channel;
  }
  return "webhook";
}

function buildAutomationDialogInitialValues(input: {
  name: string;
  description?: string | null;
  workspaceId: string;
  enabled: boolean;
  executionMode: AutomationExecutionMode;
  schedule: TaskSchedule;
  prompt: string;
  requestMetadata: Record<string, unknown>;
  delivery: DeliveryConfig;
  timeoutSecs?: number | null;
  maxRetries: number;
}): AutomationJobDialogInitialValues {
  const {
    name,
    description,
    workspaceId,
    enabled,
    executionMode,
    schedule,
    prompt,
    requestMetadata,
    delivery,
    timeoutSecs,
    maxRetries,
  } = input;

  return {
    name,
    description: description ?? "",
    workspace_id: workspaceId,
    enabled,
    execution_mode: executionMode,
    payload_kind: "agent_turn",
    prompt,
    system_prompt: "你正在执行 SceneApp 自动化任务。",
    web_search: false,
    agent_content_id: "",
    agent_access_mode: "full-access",
    agent_request_metadata: requestMetadata,
    timeout_secs:
      typeof timeoutSecs === "number" && Number.isFinite(timeoutSecs)
        ? String(timeoutSecs)
        : "",
    max_retries: String(maxRetries),
    delivery_mode: delivery.mode,
    delivery_channel: normalizeDialogDeliveryChannel(delivery),
    delivery_target: delivery.target ?? "",
    delivery_output_schema: delivery.output_schema ?? "text",
    delivery_output_format: delivery.output_format ?? "text",
    best_effort: delivery.best_effort,
    ...(schedule.kind === "every"
      ? {
          schedule_kind: "every" as const,
          every_secs: String(schedule.every_secs),
        }
      : schedule.kind === "cron"
        ? {
            schedule_kind: "cron" as const,
            cron_expr: schedule.expr,
            cron_tz: schedule.tz ?? "Asia/Shanghai",
          }
        : {
            schedule_kind: "at" as const,
            at_local: toDateTimeLocal(schedule.at),
          }),
  };
}

function buildAutomationExecutionDraft(
  result: SceneAppPlanResult,
): SceneAppAutomationExecutionDraft {
  const requestMetadata = readRequestMetadata(result);
  const launchPayload = readLaunchPayload(result);
  const launchIntent = resolveSceneAppLaunchIntent(result);
  const schedule = normalizeSchedule(readRecord(launchPayload, "schedule"));
  const delivery = normalizeDeliveryConfig(
    readRecord(launchPayload, "delivery"),
  );
  const enabled = readBoolean(launchPayload, "enabled") ?? true;
  const executionMode = normalizeExecutionMode(
    readText(launchPayload, "execution_mode", "executionMode"),
  );
  const timeoutSecs =
    readNumber(launchPayload, "timeout_secs", "timeoutSecs") ?? null;
  const maxRetries =
    readNumber(launchPayload, "max_retries", "maxRetries") ?? 3;
  const prompt = buildAutomationPrompt(result);
  const name =
    readText(launchPayload, "name") ?? `${result.descriptor.title} 自动化`;
  const description =
    readText(launchPayload, "description") ??
    `由 SceneApp ${result.descriptor.title} 派生的自动化任务。`;
  const workspaceId =
    readText(launchPayload, "workspace_id", "workspaceId") ??
    launchIntent.workspaceId ??
    launchIntent.projectId ??
    "";
  const automationIntent: SceneAppAutomationIntent = {
    launchIntent,
    name,
    description,
    schedule,
    enabled,
    executionMode,
    delivery,
    timeoutSecs,
    maxRetries,
    runNow: false,
  };

  return {
    kind: "automation_job",
    sceneappId: result.descriptor.id,
    runtimeAction: "create_automation_job",
    adapterKind: "automation_job",
    targetRef: result.plan.adapterPlan.targetRef,
    targetLabel: result.plan.adapterPlan.targetLabel,
    automationIntent,
    automationRequest: {
      name,
      description,
      enabled,
      workspace_id: workspaceId,
      execution_mode: executionMode,
      schedule,
      payload: {
        kind: "agent_turn",
        prompt,
        system_prompt: "你正在执行 SceneApp 自动化任务。",
        web_search: false,
        approval_policy: "never",
        sandbox_policy: "danger-full-access",
        request_metadata: requestMetadata,
      },
      delivery,
      timeout_secs: timeoutSecs,
      max_retries: maxRetries,
    },
    automationDialogInitialValues: buildAutomationDialogInitialValues({
      name,
      description,
      workspaceId,
      enabled,
      executionMode,
      schedule,
      prompt,
      requestMetadata,
      delivery,
      timeoutSecs,
      maxRetries,
    }),
    notes: resolveSceneAppNotes(result),
  };
}

export function buildSceneAppExecutionDraft(
  result: SceneAppPlanResult,
): SceneAppExecutionDraft {
  if (result.plan.adapterPlan.runtimeAction === "create_automation_job") {
    return buildAutomationExecutionDraft(result);
  }

  return buildWorkspaceExecutionDraft(result);
}
