import type { AutomationJobDialogInitialValues } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { composeServiceSkillAutomationPrompt } from "./promptComposer";
import type {
  ServiceSkillItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";

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
): string {
  const scheduleSlot = skill.slotSchema.find((slot) => slot.type === "schedule_time");
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

function buildCronPrefill(expr: string): Pick<
  AutomationJobDialogInitialValues,
  "schedule_kind" | "cron_expr" | "cron_tz"
> {
  return {
    schedule_kind: "cron",
    cron_expr: expr,
    cron_tz: resolveLocalTimeZone(),
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

  const weekdayMatch = value.match(/^每周([一二三四五六日天])\s*(\d{1,2}):(\d{2})$/);
  if (weekdayMatch) {
    const cronDay = WEEKDAY_TO_CRON_DAY[weekdayMatch[1]];
    if (cronDay) {
      return buildCronPrefill(
        `${weekdayMatch[3]} ${weekdayMatch[2]} * * ${cronDay}`,
      );
    }
  }

  const weekdayDailyMatch = value.match(/^(?:工作日|每个工作日)\s*(\d{1,2}):(\d{2})$/);
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
  const lines = [skill.summary, "来源：服务型技能本地自动化草稿。"];
  if (scheduleValue.trim()) {
    lines.push(`预设调度：${scheduleValue.trim()}`);
  }
  return lines.join("\n");
}

export function supportsServiceSkillLocalAutomation(
  skill: ServiceSkillItem,
): boolean {
  return (
    skill.executionLocation === "client_default" &&
    skill.runnerType !== "instant"
  );
}

export function buildServiceSkillAutomationInitialValues({
  skill,
  slotValues,
  userInput,
  workspaceId,
}: BuildServiceSkillAutomationInitialValuesInput): AutomationJobDialogInitialValues {
  const scheduleValue = resolveScheduleSlotValue(skill, slotValues);
  const schedulePrefill = parseScheduleTextToPrefill(scheduleValue);

  return {
    name: buildServiceSkillAutomationName(skill),
    description: buildServiceSkillAutomationDescription(skill, scheduleValue),
    workspace_id: workspaceId,
    enabled: true,
    execution_mode: "skill",
    payload_kind: "agent_turn",
    prompt: composeServiceSkillAutomationPrompt({
      skill,
      slotValues,
      userInput,
    }),
    system_prompt: "",
    web_search: false,
    max_retries: "2",
    delivery_mode: "none",
    ...schedulePrefill,
  };
}
