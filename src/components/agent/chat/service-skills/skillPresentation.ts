import { isServiceSkillExecutableAsSiteAdapter } from "./siteCapabilityBinding";
import type {
  ServiceSkillHomeItem,
  ServiceSkillItem,
  ServiceSkillRunnerType,
  ServiceSkillTone,
  ServiceSkillType,
} from "./types";

const RUNNER_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "立即开始",
  scheduled: "定时执行",
  managed: "持续跟踪",
};

const RUNNER_TONES: Record<ServiceSkillRunnerType, ServiceSkillTone> = {
  instant: "emerald",
  scheduled: "sky",
  managed: "amber",
};

const RUNNER_DESCRIPTIONS: Record<ServiceSkillRunnerType, string> = {
  instant: "会直接在当前工作区生成首版结果，方便继续补充与改写。",
  scheduled: "会先生成首轮结果，再按设定时间持续回流到任务中心。",
  managed: "会先生成首轮策略，再持续跟踪并回流后续结果与提醒。",
};

const LOCAL_ACTION_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "对话内补参",
  scheduled: "创建任务",
  managed: "创建跟踪",
};

const SERVICE_SKILL_TYPE_LABELS: Record<ServiceSkillType, string> = {
  service: "创作技能",
  site: "站点技能",
  prompt: "提示技能",
};

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

export function getServiceSkillRunnerLabel(item: ServiceSkillItem): string {
  if (item.executionLocation === "cloud_required") {
    return "云端执行";
  }
  if (resolveServiceSkillType(item) === "site") {
    return "浏览器采集";
  }
  return RUNNER_LABELS[item.runnerType];
}

export function getServiceSkillRunnerTone(
  item: Pick<ServiceSkillItem, "executionLocation" | "runnerType">,
): ServiceSkillTone {
  if (item.executionLocation === "cloud_required") {
    return "slate";
  }
  return RUNNER_TONES[item.runnerType];
}

export function getServiceSkillRunnerDescription(
  item: ServiceSkillItem,
): string {
  if (item.executionLocation === "cloud_required") {
    return "会交给云端处理，完成后再把结果回流到当前工作区。";
  }
  if (resolveServiceSkillType(item) === "site") {
    return "会复用当前浏览器里的真实登录态执行站点任务，并优先把结果沉淀到当前工作区。";
  }
  return RUNNER_DESCRIPTIONS[item.runnerType];
}

export function getServiceSkillActionLabel(item: ServiceSkillItem): string {
  if (item.executionLocation === "cloud_required") {
    return "云端执行";
  }
  if (resolveServiceSkillType(item) === "site") {
    if (hasRequiredSlots(item)) {
      return "对话内补参";
    }
    return "开始执行";
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

  if (item.executionLocation === "cloud_required") {
    return "运行结果会在云端完成后回流到当前工作区。";
  }

  if (isServiceSkillExecutableAsSiteAdapter(item)) {
    return item.siteCapabilityBinding.saveMode === "project_resource"
      ? "结果会沉淀为当前项目资源，方便后续复用。"
      : "结果会优先写回当前内容，继续在当前工作区整理。";
  }

  if (item.runnerType === "scheduled") {
    return "首轮结果会进入当前工作区；后续结果会同步到任务中心。";
  }

  if (item.runnerType === "managed") {
    return "首轮策略会进入当前工作区；后续跟踪结果会持续回流。";
  }

  return "结果会写回当前工作区，方便继续编辑。";
}

export function listServiceSkillDependencies(item: ServiceSkillItem): string[] {
  const requirements: string[] = [];

  if (item.readinessRequirements?.requiresModel) {
    requirements.push("需要已选择可用模型。");
  }
  if (item.readinessRequirements?.requiresBrowser) {
    requirements.push("需要当前浏览器里已有对应站点的登录态。");
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
    return "创建任务并进入工作区";
  }
  if (skill.executionLocation === "cloud_required") {
    return "云端执行";
  }
  if (resolveServiceSkillType(skill) === "site") {
    if (hasRequiredSlots(skill)) {
      return "对话内补参";
    }
    return "开始执行";
  }
  return "进入工作区";
}
