import type { AutomationJobDialogInitialValues } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { resolveBaseSetupAutomationProjectionForSkill } from "@/lib/base-setup/automationProjection";
import { buildHarnessRequestMetadata } from "../utils/harnessRequestMetadata";
import { composeServiceSkillAutomationPrompt } from "./promptComposer";
import type {
  ServiceSkillItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";
import { buildServiceSkillWorkspaceSeed } from "./workspaceLaunch";

const DEFAULT_AUTOMATION_INTERVAL_SECS = 86_400;
const WEEKDAY_TO_CRON_DAY: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  日: "0",
  天: "0",
};

interface BuildServiceSkillAutomationInitialValuesInput {
  skill: ServiceSkillItem;
  slotValues: ServiceSkillSlotValues;
  userInput?: string;
  workspaceId: string;
}

interface BuildServiceSkillAutomationAgentTurnPayloadContextInput {
  skill: ServiceSkillItem;
  slotValues?: ServiceSkillSlotValues;
  userInput?: string;
  contentId?: string | null;
}

function resolveSlotValue(
  slot: ServiceSkillSlotDefinition,
  slotValues: ServiceSkillSlotValues,
): string {
  const currentValue = slotValues[slot.key]?.trim();
  if (currentValue) {
    return currentValue;
  }
  return slot.defaultValue?.trim() || "";
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function resolveSlotDisplayValue(
  slot: ServiceSkillSlotDefinition,
  slotValues: ServiceSkillSlotValues,
): string {
  const resolved = resolveSlotValue(slot, slotValues);
  if (!resolved) {
    return "";
  }

  const matchedOption = slot.options?.find(
    (option) => option.value === resolved,
  );
  return matchedOption?.label?.trim() || resolved;
}

function summarizeMetadataValue(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildServiceSkillAutomationSlotSummary(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): Array<{ key: string; label: string; value: string }> {
  return skill.slotSchema
    .map((slot) => {
      const displayValue = resolveSlotDisplayValue(slot, slotValues);
      if (!displayValue) {
        return null;
      }
      return {
        key: slot.key,
        label: slot.label,
        value: summarizeMetadataValue(displayValue),
      };
    })
    .filter((item): item is { key: string; label: string; value: string } =>
      Boolean(item),
    );
}

function resolveLocalTimeZone(): string {
  if (
    typeof Intl !== "undefined" &&
    typeof Intl.DateTimeFormat === "function"
  ) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone === "string" && timeZone.trim()) {
      return timeZone;
    }
  }
  return "Asia/Shanghai";
}

function resolveScheduleSlotValue(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
  preferredSlotKey?: string,
): string {
  if (preferredSlotKey) {
    const currentValue = slotValues[preferredSlotKey]?.trim();
    if (currentValue) {
      return currentValue;
    }
    return "";
  }

  const scheduleSlot = skill.slotSchema.find(
    (slot) => slot.type === "schedule_time",
  );
  if (!scheduleSlot) {
    return "";
  }
  return resolveSlotValue(scheduleSlot, slotValues);
}

function buildDefaultSchedulePrefill(): Pick<
  AutomationJobDialogInitialValues,
  "schedule_kind" | "every_secs"
> {
  return {
    schedule_kind: "every",
    every_secs: String(DEFAULT_AUTOMATION_INTERVAL_SECS),
  };
}

function buildCronPrefill(
  expr: string,
): Pick<
  AutomationJobDialogInitialValues,
  "schedule_kind" | "cron_expr" | "cron_tz"
> {
  return {
    schedule_kind: "cron",
    cron_expr: expr,
    cron_tz: resolveLocalTimeZone(),
  };
}

function buildAtPrefill(
  at: string,
): Pick<AutomationJobDialogInitialValues, "schedule_kind" | "at_local"> {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return {
      schedule_kind: "at",
      at_local: "",
    };
  }

  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return {
    schedule_kind: "at",
    at_local: date.toISOString().slice(0, 16),
  };
}

function parseScheduleTextToPrefill(
  rawValue: string,
): Pick<
  AutomationJobDialogInitialValues,
  "schedule_kind" | "every_secs" | "cron_expr" | "cron_tz"
> {
  const value = rawValue.trim();
  if (!value) {
    return buildDefaultSchedulePrefill();
  }

  const everyMatch = value.match(/^每\s*(\d+)\s*(秒|分钟|分|小时|时)$/);
  if (everyMatch) {
    const amount = Number(everyMatch[1]);
    const unit = everyMatch[2];
    if (Number.isFinite(amount) && amount > 0) {
      const everySecs =
        unit === "秒"
          ? amount
          : unit === "分钟" || unit === "分"
            ? amount * 60
            : amount * 3_600;
      return {
        schedule_kind: "every",
        every_secs: String(Math.max(60, everySecs)),
      };
    }
  }

  const dailyMatch = value.match(/^(?:每天|每日)\s*(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return buildCronPrefill(`${dailyMatch[2]} ${dailyMatch[1]} * * *`);
  }

  const weekdayMatch = value.match(
    /^每周([一二三四五六日天])\s*(\d{1,2}):(\d{2})$/,
  );
  if (weekdayMatch) {
    const cronDay = WEEKDAY_TO_CRON_DAY[weekdayMatch[1]];
    if (cronDay) {
      return buildCronPrefill(
        `${weekdayMatch[3]} ${weekdayMatch[2]} * * ${cronDay}`,
      );
    }
  }

  const weekdayDailyMatch = value.match(
    /^(?:工作日|每个工作日)\s*(\d{1,2}):(\d{2})$/,
  );
  if (weekdayDailyMatch) {
    return buildCronPrefill(
      `${weekdayDailyMatch[2]} ${weekdayDailyMatch[1]} * * 1-5`,
    );
  }

  return buildDefaultSchedulePrefill();
}

function buildServiceSkillAutomationName(skill: ServiceSkillItem): string {
  if (skill.runnerType === "managed") {
    return `${skill.title}｜持续跟踪`;
  }
  if (skill.runnerType === "scheduled") {
    return `${skill.title}｜定时执行`;
  }
  return `${skill.title}｜本地任务`;
}

function buildServiceSkillAutomationDescription(
  skill: ServiceSkillItem,
  scheduleValue: string,
): string {
  const lines = [skill.summary, "来源：技能本地自动化草稿。"];
  if (scheduleValue.trim()) {
    lines.push(`预设调度：${scheduleValue.trim()}`);
  }
  return lines.join("\n");
}

function buildServiceSkillAutomationMetadata(input: {
  skill: ServiceSkillItem;
  slotValues?: ServiceSkillSlotValues;
  userInput?: string;
}): Record<string, unknown> {
  const { skill, slotValues, userInput } = input;
  const automationProjection = resolveBaseSetupAutomationProjectionForSkill(skill);
  const slotSummary = slotValues
    ? buildServiceSkillAutomationSlotSummary(skill, slotValues)
    : [];
  const normalizedUserInput = normalizeOptionalText(userInput);

  return {
    id: skill.id,
    title: skill.title,
    runner_type: skill.runnerType,
    execution_location: skill.executionLocation,
    source: skill.source,
    base_setup:
      automationProjection.refs.packageId ||
      automationProjection.refs.packageVersion ||
      automationProjection.refs.projectionId ||
      automationProjection.refs.automationProfileRef
        ? {
            package_id: automationProjection.refs.packageId ?? null,
            package_version: automationProjection.refs.packageVersion ?? null,
            projection_id: automationProjection.refs.projectionId ?? null,
            automation_profile_ref:
              automationProjection.refs.automationProfileRef ?? null,
          }
        : undefined,
    slot_values: slotSummary,
    slot_summary: slotSummary.map((item) => `${item.label}: ${item.value}`),
    user_input: normalizedUserInput ?? null,
  };
}

function buildServiceSkillAutomationRequestMetadata(input: {
  skill: ServiceSkillItem;
  slotValues?: ServiceSkillSlotValues;
  userInput?: string;
  contentId?: string | null;
}): Record<string, unknown> | undefined {
  const { skill, slotValues, userInput, contentId } = input;
  const targetTheme = skill.themeTarget?.trim();
  const workspaceSeed = buildServiceSkillWorkspaceSeed(skill, targetTheme);

  return {
    ...(workspaceSeed?.requestMetadata ?? {}),
    service_skill: buildServiceSkillAutomationMetadata({
      skill,
      slotValues,
      userInput,
    }),
    harness: buildHarnessRequestMetadata({
      theme: targetTheme || "general",
      preferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
      sessionMode: workspaceSeed ? "general_workbench" : "default",
      runTitle: skill.title,
      contentId: contentId || undefined,
    }),
  };
}

export function supportsServiceSkillLocalAutomation(
  skill: ServiceSkillItem,
): boolean {
  return (
    skill.executionLocation === "client_default" &&
    skill.runnerType !== "instant"
  );
}

export function buildServiceSkillAutomationAgentTurnPayloadContext({
  skill,
  slotValues,
  userInput,
  contentId,
}: BuildServiceSkillAutomationAgentTurnPayloadContextInput): {
  content_id?: string | null;
  request_metadata?: Record<string, unknown> | null;
} {
  const normalizedContentId = contentId?.trim() || null;
  const requestMetadata = buildServiceSkillAutomationRequestMetadata({
    skill,
    slotValues,
    userInput,
    contentId: normalizedContentId,
  });

  return {
    content_id: normalizedContentId,
    request_metadata: requestMetadata ?? null,
  };
}

export function buildServiceSkillAutomationInitialValues({
  skill,
  slotValues,
  userInput,
  workspaceId,
}: BuildServiceSkillAutomationInitialValuesInput): AutomationJobDialogInitialValues {
  const automationProjection = resolveBaseSetupAutomationProjectionForSkill(skill);
  const scheduleValue = resolveScheduleSlotValue(
    skill,
    slotValues,
    automationProjection.profile?.schedule?.slotKey,
  );
  const schedulePrefill = scheduleValue.trim()
    ? parseScheduleTextToPrefill(scheduleValue)
    : automationProjection.profile?.schedule?.kind === "every"
      ? {
          schedule_kind: "every" as const,
          every_secs: String(automationProjection.profile.schedule.everySecs),
        }
      : automationProjection.profile?.schedule?.kind === "cron"
        ? {
            schedule_kind: "cron" as const,
            cron_expr: automationProjection.profile.schedule.cronExpr,
            cron_tz:
              automationProjection.profile.schedule.cronTz ||
              resolveLocalTimeZone(),
          }
        : automationProjection.profile?.schedule?.kind === "at"
          ? buildAtPrefill(automationProjection.profile.schedule.at)
          : buildDefaultSchedulePrefill();
  const deliveryPrefill =
    automationProjection.profile?.delivery?.mode === "announce"
      ? {
          delivery_mode: "announce" as const,
          delivery_channel:
            automationProjection.profile.delivery.channel ?? "webhook",
          delivery_target: automationProjection.profile.delivery.target ?? "",
          delivery_output_schema:
            automationProjection.profile.delivery.outputSchema ?? "text",
          delivery_output_format:
            automationProjection.profile.delivery.outputFormat ?? "text",
          best_effort:
            automationProjection.profile.delivery.bestEffort ?? true,
        }
      : {
          delivery_mode: "none" as const,
          best_effort:
            automationProjection.profile?.delivery?.bestEffort ?? true,
        };

  return {
    name: buildServiceSkillAutomationName(skill),
    description: buildServiceSkillAutomationDescription(skill, scheduleValue),
    workspace_id: workspaceId,
    execution_mode: "skill",
    payload_kind: "agent_turn",
    prompt: composeServiceSkillAutomationPrompt({
      skill,
      slotValues,
      userInput,
    }),
    system_prompt: "",
    web_search: false,
    agent_content_id: "",
    agent_request_metadata: buildServiceSkillAutomationAgentTurnPayloadContext({
      skill,
      slotValues,
      userInput,
    }).request_metadata,
    max_retries:
      automationProjection.profile?.maxRetries !== undefined
        ? String(automationProjection.profile.maxRetries)
        : "2",
    enabled: automationProjection.profile?.enabledByDefault ?? true,
    ...deliveryPrefill,
    ...schedulePrefill,
  };
}
