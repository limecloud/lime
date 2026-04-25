import { resolveServiceSkillEntryDescription } from "./entryAdapter";
import { isServiceSkillExecutableAsSiteAdapter } from "./siteCapabilityBinding";
import type {
  ServiceSkillHomeItem,
  ServiceSkillItem,
  ServiceSkillRunnerType,
  ServiceSkillTone,
  ServiceSkillType,
} from "./types";

const RUNNER_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "先做这一轮",
  scheduled: "按时继续",
  managed: "持续跟进",
};

const RUNNER_TONES: Record<ServiceSkillRunnerType, ServiceSkillTone> = {
  instant: "emerald",
  scheduled: "sky",
  managed: "amber",
};

const RUNNER_DESCRIPTIONS: Record<ServiceSkillRunnerType, string> = {
  instant: "会先给出这一轮结果，接着就能继续改。",
  scheduled: "会先给出第一轮结果，后面按设定时间继续带回来。",
  managed: "会先给出这轮判断，后面持续带回新的结果和提醒。",
};

const LOCAL_ACTION_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "开始这一步",
  scheduled: "开始持续",
  managed: "开始跟进",
};

const SERVICE_SKILL_TYPE_LABELS: Record<ServiceSkillType, string> = {
  service: "创作做法",
  site: "站点做法",
  prompt: "提示做法",
};

interface BuildServiceSkillCapabilityDescriptionOptions {
  includeSummary?: boolean;
  includeRequiredInputs?: boolean;
  includeOutputHint?: boolean;
  requiredInputsLimit?: number;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

function hasRequiredSlots(
  item: Pick<ServiceSkillItem, "slotSchema">,
): boolean {
  return item.slotSchema.some((slot) => slot.required);
}

function summarizeServiceSkillFactItems(
  items: string[],
  limit = 2,
): string {
  const normalizedItems = uniqueStrings(items);
  if (normalizedItems.length === 0) {
    return "";
  }

  if (normalizedItems.length <= limit) {
    return normalizedItems.join("、");
  }

  return `${normalizedItems.slice(0, limit).join("、")} 等 ${normalizedItems.length} 项`;
}

function readServiceSkillBundleMetadata(
  item: Pick<ServiceSkillItem, "skillBundle">,
  key: string,
): string | null {
  const value = item.skillBundle?.metadata?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveServiceSkillTypeFromBundle(
  item: Pick<ServiceSkillItem, "skillBundle">,
): ServiceSkillType | null {
  const skillType = readServiceSkillBundleMetadata(item, "Lime_skill_type");
  if (
    skillType === "service" ||
    skillType === "site" ||
    skillType === "prompt"
  ) {
    return skillType;
  }
  return null;
}

export function resolveServiceSkillType(
  item: Pick<
    ServiceSkillItem,
    | "skillType"
    | "defaultExecutorBinding"
    | "siteCapabilityBinding"
    | "skillBundle"
  >,
): ServiceSkillType {
  if (item.skillType) {
    return item.skillType;
  }

  const skillTypeFromBundle = resolveServiceSkillTypeFromBundle(item);
  if (skillTypeFromBundle) {
    return skillTypeFromBundle;
  }

  if (
    item.defaultExecutorBinding === "browser_assist" ||
    isServiceSkillExecutableAsSiteAdapter(item)
  ) {
    return "site";
  }

  return "service";
}

export function getServiceSkillTypeLabel(item: ServiceSkillItem): string {
  return SERVICE_SKILL_TYPE_LABELS[resolveServiceSkillType(item)];
}

export function summarizeServiceSkillRequiredInputs(
  item: Pick<ServiceSkillItem, "slotSchema">,
  limit = 2,
): string {
  const requiredInputLabels = item.slotSchema
    .filter((slot) => slot.required)
    .map((slot) => slot.label);

  if (requiredInputLabels.length === 0) {
    return "当前无必填信息";
  }

  return summarizeServiceSkillFactItems(requiredInputLabels, limit);
}

export function buildServiceSkillCapabilityDescription(
  item: Pick<ServiceSkillItem, "entryHint" | "summary" | "slotSchema" | "outputHint">,
  options: BuildServiceSkillCapabilityDescriptionOptions = {},
): string {
  const segments: string[] = [];

  if (options.includeSummary ?? true) {
    segments.push(resolveServiceSkillEntryDescription(item));
  }

  if (options.includeRequiredInputs ?? true) {
    segments.push(
      `需要：${summarizeServiceSkillRequiredInputs(
        item,
        options.requiredInputsLimit,
      )}`,
    );
  }

  if (options.includeOutputHint ?? true) {
    segments.push(`交付：${item.outputHint.trim()}`);
  }

  return segments.join(" · ");
}

export function getServiceSkillRunnerLabel(item: ServiceSkillItem): string {
  if (resolveServiceSkillType(item) === "site") {
    return "接着浏览器继续";
  }
  return RUNNER_LABELS[item.runnerType];
}

export function getServiceSkillRunnerTone(
  item: Pick<ServiceSkillItem, "runnerType">,
): ServiceSkillTone {
  return RUNNER_TONES[item.runnerType];
}

export function getServiceSkillRunnerDescription(
  item: ServiceSkillItem,
): string {
  if (resolveServiceSkillType(item) === "site") {
    return "会接着当前浏览器里已经打开的页面把这一步做完，并把结果带回生成。";
  }
  return RUNNER_DESCRIPTIONS[item.runnerType];
}

export function getServiceSkillActionLabel(item: ServiceSkillItem): string {
  if (hasRequiredSlots(item)) {
    return "补齐这一步";
  }

  if (resolveServiceSkillType(item) === "site") {
    return "接着继续";
  }
  return LOCAL_ACTION_LABELS[item.runnerType];
}

export function getServiceSkillOutputDestination(
  item: ServiceSkillItem,
): string {
  if (item.outputDestination?.trim()) {
    return item.outputDestination.trim();
  }

  const outputDestinationFromBundle = readServiceSkillBundleMetadata(
    item,
    "Lime_output_destination",
  );
  if (outputDestinationFromBundle) {
    return outputDestinationFromBundle;
  }

  if (isServiceSkillExecutableAsSiteAdapter(item)) {
    return item.siteCapabilityBinding.saveMode === "project_resource"
      ? "结果会收进当前项目资料，后面还能继续拿来用。"
      : "结果会先回到当前内容里，方便接着往下改。";
  }

  if (item.runnerType === "scheduled") {
    return "第一轮结果会先回到生成，后面按时间继续接回来。";
  }

  if (item.runnerType === "managed") {
    return "这轮判断会先回到生成，后面新的结果和提醒也会继续带回来。";
  }

  return "结果会回到生成，方便接着改。";
}

export function listServiceSkillDependencies(item: ServiceSkillItem): string[] {
  const requirements: string[] = [];

  if (item.readinessRequirements?.requiresModel) {
    requirements.push("需要已选择可用模型。");
  }
  if (item.readinessRequirements?.requiresBrowser) {
    requirements.push("需要当前浏览器里已经打开并登录对应站点。");
  }
  if (item.readinessRequirements?.requiresProject) {
    requirements.push("建议在目标项目内启动，便于结果直接回写。");
  }
  if (item.readinessRequirements?.requiresSkillKey) {
    requirements.push(
      `需要先启用相关能力：${item.readinessRequirements.requiresSkillKey}。`,
    );
  }

  return uniqueStrings([...(item.setupRequirements ?? []), ...requirements]);
}

export function getServiceSkillPrimaryActionLabel(
  skill: ServiceSkillHomeItem,
  canCreateAutomation: boolean,
): string {
  if (canCreateAutomation) {
    return "开始持续";
  }
  return getServiceSkillActionLabel(skill);
}
