import type {
  ServiceSkillItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";

export interface ServiceSkillSlotValidationResult {
  valid: boolean;
  missing: ServiceSkillSlotDefinition[];
}

export interface ComposeServiceSkillPromptInput {
  skill: ServiceSkillItem;
  slotValues: ServiceSkillSlotValues;
  userInput?: string;
}

const RUNNER_LABELS = {
  instant: "一次性交付",
  scheduled: "定时任务",
  managed: "持续跟踪",
} as const;

const EXECUTION_LOCATION_LABELS = {
  client_default: "客户端默认执行",
  cloud_required: "服务端特例执行",
} as const;

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

function buildServiceSkillPromptLines(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
  userInput?: string,
): string[] {
  const lines: string[] = [
    `[服务型技能] ${skill.title}`,
    `[目录来源] ${skill.source === "cloud_catalog" ? "云目录（客户端起步版）" : "本地目录"}`,
    `[任务形态] ${RUNNER_LABELS[skill.runnerType]}`,
    `[执行位置] ${EXECUTION_LOCATION_LABELS[skill.executionLocation]}`,
    `[任务摘要] ${skill.summary}`,
    "[参数]",
  ];

  for (const slot of skill.slotSchema) {
    lines.push(`- ${slot.label}: ${resolveSlotValue(slot, slotValues) || "未提供"}`);
  }

  if (userInput?.trim()) {
    lines.push(`[补充要求] ${userInput.trim()}`);
  }

  return lines;
}

export function createDefaultServiceSkillSlotValues(
  skill: ServiceSkillItem,
): ServiceSkillSlotValues {
  return skill.slotSchema.reduce<ServiceSkillSlotValues>((acc, slot) => {
    acc[slot.key] = slot.defaultValue ?? "";
    return acc;
  }, {});
}

export function validateServiceSkillSlotValues(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): ServiceSkillSlotValidationResult {
  const missing = skill.slotSchema.filter((slot) => {
    if (!slot.required) {
      return false;
    }
    return !resolveSlotValue(slot, slotValues);
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function formatServiceSkillPromptPreview(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): string {
  const resolvedValues = skill.slotSchema
    .map((slot) => `${slot.label}：${resolveSlotValue(slot, slotValues) || "待补充"}`)
    .slice(0, 3);

  return `${skill.title}｜${resolvedValues.join("｜")}`;
}

export function composeServiceSkillPrompt({
  skill,
  slotValues,
  userInput,
}: ComposeServiceSkillPromptInput): string {
  const lines = buildServiceSkillPromptLines(skill, slotValues, userInput);

  if (skill.runnerType === "instant") {
    lines.push(
      "[执行要求] 现在直接开始，优先产出一版可交付结果；若信息不足，先给出最小缺口，再继续推进。",
    );
  } else if (skill.runnerType === "scheduled") {
    lines.push(
      "[执行要求] 当前为客户端起步版。请先产出一版首轮结果，并补充后续本地定时任务的执行步骤、调度建议、失败处理点和需要保留的参数。",
    );
  } else {
    lines.push(
      "[执行要求] 当前为客户端起步版。请先产出一版首轮分析或执行方案，并补充后续本地持续跟踪任务的关键指标、告警阈值、回报节奏和自动化建议。",
    );
  }

  if (skill.themeTarget) {
    lines.push(`[建议主题] ${skill.themeTarget}`);
  }

  return lines.join("\n");
}

export function composeServiceSkillAutomationPrompt({
  skill,
  slotValues,
  userInput,
}: ComposeServiceSkillPromptInput): string {
  const lines = buildServiceSkillPromptLines(skill, slotValues, userInput);

  if (skill.runnerType === "scheduled") {
    lines.push(
      "[自动化执行要求] 这是一个由本地自动化定时触发的任务。每次运行都要完成本轮结果，优先输出当前周期的摘要、变化、异常和下一步建议；若本轮没有明显变化，也要明确说明“本轮无显著变化”。",
    );
  } else if (skill.runnerType === "managed") {
    lines.push(
      "[自动化执行要求] 这是一个由本地自动化持续跟踪的任务。每次运行都要先比较关键指标和上轮变化，再输出风险、告警、原因判断和建议动作；若触发阈值，必须把异常项单独列出。",
    );
  } else {
    lines.push(
      "[自动化执行要求] 当前任务由本地自动化触发。请直接产出本轮结果，并在必要时明确补充信息缺口。",
    );
  }

  if (skill.themeTarget) {
    lines.push(`[建议主题] ${skill.themeTarget}`);
  }

  return lines.join("\n");
}
