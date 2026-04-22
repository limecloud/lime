import {
  resolveServiceSkillExecutionLocationPresentation,
  SERVICE_SKILL_EXECUTION_LOCATION_LABEL,
} from "@/lib/api/serviceSkills";
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

function resolvePromptTemplateKey(
  skill: Pick<ServiceSkillItem, "id" | "skillKey" | "promptTemplateKey">,
): NonNullable<ServiceSkillItem["promptTemplateKey"]> {
  if (skill.promptTemplateKey) {
    return skill.promptTemplateKey;
  }

  const identity = skill.skillKey ?? skill.id;
  if (
    identity === "carousel-post-replication" ||
    identity === "short-video-script-replication"
  ) {
    return "replication";
  }
  if (identity === "daily-trend-briefing") {
    return "trend_briefing";
  }
  if (identity === "account-performance-tracking") {
    return "account_growth";
  }
  return "generic";
}

function appendServiceSkillTemplateRequirements(
  lines: string[],
  skill: ServiceSkillItem,
): void {
  switch (resolvePromptTemplateKey(skill)) {
    case "replication":
      lines.push(
        "[执行重点] 先拆解参考样本的结构、节奏、卖点与语言风格，再给出一版贴近原逻辑但可继续调整的结果。",
      );
      lines.push(
        "[输出结构] 先写拆解结论，再写首版内容，最后列出最值得继续微调的 3 个点。",
      );
      break;
    case "trend_briefing":
      lines.push(
        "[执行重点] 先判断现在什么最热、为什么会火、哪些变化最值得跟进，再整理建议动作。",
      );
      lines.push(
        "[输出结构] 结论摘要、热点变化、原因判断、建议动作、后续跟踪建议。",
      );
      break;
    case "account_growth":
      lines.push(
        "[执行重点] 先拆参考账号的内容策略、节奏和增长抓手，再输出可执行的增长方案与跟踪指标。",
      );
      lines.push(
        "[输出结构] 现状判断、对标拆解、增长动作、发布节奏、监测指标与告警条件。",
      );
      break;
    default:
      break;
  }
}

function appendServiceSkillAutomationTemplateRequirements(
  lines: string[],
  skill: ServiceSkillItem,
): void {
  switch (resolvePromptTemplateKey(skill)) {
    case "trend_briefing":
      lines.push(
        "[自动化执行重点] 每轮先对比上轮变化，再明确新增热点、回落话题、值得跟进的信号和建议动作。",
      );
      break;
    case "account_growth":
      lines.push(
        "[自动化执行重点] 每轮先比较账号表现与目标差距，再输出增长异常、原因判断、行动建议与告警项。",
      );
      break;
    case "replication":
      lines.push(
        "[自动化执行重点] 每轮都要先提炼参考样本的新变化，再给出贴近当前样本的最新版内容建议。",
      );
      break;
    default:
      break;
  }
}

function appendMinimalClarificationProtocol(lines: string[]): void {
  lines.push(
    "[澄清协议] 默认先基于现有信息产出首版结果，不要因为存在次要缺口就暂停。",
  );
  lines.push(
    "[澄清协议] 只有在缺少的信息会显著改变下一步执行结果时，才请求补充；单轮最多追问 1 个最关键问题或 1 个关键字段。",
  );
  lines.push(
    "[澄清协议] 其余可合理假设的信息，先明确假设并继续；不要一次性索要全部缺失参数，不要输出多题问卷。",
  );
}

export function resolveServiceSkillSlotValue(
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
  const executionLocationLabel =
    resolveServiceSkillExecutionLocationPresentation(skill.executionLocation)
      ?.label ?? SERVICE_SKILL_EXECUTION_LOCATION_LABEL;
  const lines: string[] = [
    `[技能任务] ${skill.title}`,
    `[目录来源] ${skill.source === "cloud_catalog" ? "云目录（客户端起步版）" : "本地目录"}`,
    `[任务形态] ${RUNNER_LABELS[skill.runnerType]}`,
    `[执行位置] ${executionLocationLabel}`,
    `[任务摘要] ${skill.summary}`,
    "[参数]",
  ];

  for (const slot of skill.slotSchema) {
    lines.push(
      `- ${slot.label}: ${resolveServiceSkillSlotValue(slot, slotValues) || "未提供"}`,
    );
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
    return !resolveServiceSkillSlotValue(slot, slotValues);
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
    .map(
      (slot) =>
        `${slot.label}：${resolveServiceSkillSlotValue(slot, slotValues) || "待补充"}`,
    )
    .slice(0, 3);

  return `${skill.title}｜${resolvedValues.join("｜")}`;
}

export function composeServiceSkillPrompt({
  skill,
  slotValues,
  userInput,
}: ComposeServiceSkillPromptInput): string {
  const lines = buildServiceSkillPromptLines(skill, slotValues, userInput);

  appendServiceSkillTemplateRequirements(lines, skill);
  appendMinimalClarificationProtocol(lines);

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
      "[执行要求] 当前为客户端起步版。请先产出一版首轮分析或执行方案，并补充后续持续跟踪所需的关键指标、提醒阈值、回报节奏和自动化建议。",
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

  appendServiceSkillAutomationTemplateRequirements(lines, skill);
  appendMinimalClarificationProtocol(lines);

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
