import type { AutomationPayload } from "@/lib/api/automation";

export interface AutomationServiceSkillSummaryItem {
  key: string;
  label: string;
  value: string;
}

export interface AutomationServiceSkillContext {
  id: string | null;
  title: string;
  runnerLabel: string;
  executionLocationLabel: string;
  sourceLabel: string;
  theme: string | null;
  contentId: string | null;
  slotSummary: AutomationServiceSkillSummaryItem[];
  userInput: string | null;
}

const DEFAULT_SERVICE_SKILL_TITLE = "技能任务";
const UNKNOWN_SERVICE_SKILL_LABEL = "未标记";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveRunnerLabel(value: unknown): string {
  switch (value) {
    case "instant":
      return "一次性交付";
    case "scheduled":
      return "定时任务";
    case "managed":
      return "持续跟踪";
    default:
      return UNKNOWN_SERVICE_SKILL_LABEL;
  }
}

function resolveExecutionLocationLabel(value: unknown): string {
  switch (value) {
    case "client_default":
      return "客户端执行";
    case "cloud_required":
      return "云端执行";
    default:
      return UNKNOWN_SERVICE_SKILL_LABEL;
  }
}

function resolveSourceLabel(value: unknown): string {
  switch (value) {
    case "cloud_catalog":
      return "云目录";
    case "local_custom":
      return "本地自定义";
    default:
      return UNKNOWN_SERVICE_SKILL_LABEL;
  }
}

function parseSlotSummaryEntries(
  value: unknown,
): AutomationServiceSkillSummaryItem[] {
  if (Array.isArray(value)) {
    const structured = value
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const key = normalizeOptionalText(item.key);
        const label = normalizeOptionalText(item.label);
        const summaryValue = normalizeOptionalText(item.value);
        if (!label || !summaryValue) {
          return null;
        }

        return {
          key: key || label,
          label,
          value: summaryValue,
        };
      })
      .filter((item): item is AutomationServiceSkillSummaryItem =>
        Boolean(item),
      );

    if (structured.length > 0) {
      return structured;
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const summaryLine = normalizeOptionalText(item);
      if (!summaryLine) {
        return null;
      }

      const separatorIndex = summaryLine.search(/[:：]/);
      if (separatorIndex <= 0) {
        return {
          key: `slot-${index + 1}`,
          label: `参数 ${index + 1}`,
          value: summaryLine,
        };
      }

      return {
        key: `slot-${index + 1}`,
        label: summaryLine.slice(0, separatorIndex).trim(),
        value: summaryLine.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((item): item is AutomationServiceSkillSummaryItem => Boolean(item));
}

function resolveServiceSkillContextFromRecord(
  record: Record<string, unknown>,
  explicitContentId?: string | null,
): AutomationServiceSkillContext | null {
  const serviceSkillValue = record.service_skill ?? record.serviceSkill;
  if (!isRecord(serviceSkillValue)) {
    return null;
  }

  const harnessValue = isRecord(record.harness) ? record.harness : null;
  const id = normalizeOptionalText(serviceSkillValue.id);
  const title =
    normalizeOptionalText(serviceSkillValue.title) ||
    id ||
    DEFAULT_SERVICE_SKILL_TITLE;

  return {
    id,
    title,
    runnerLabel: resolveRunnerLabel(serviceSkillValue.runner_type),
    executionLocationLabel: resolveExecutionLocationLabel(
      serviceSkillValue.execution_location,
    ),
    sourceLabel: resolveSourceLabel(serviceSkillValue.source),
    theme: normalizeOptionalText(harnessValue?.theme),
    contentId:
      normalizeOptionalText(explicitContentId) ||
      normalizeOptionalText(record.content_id) ||
      normalizeOptionalText(harnessValue?.content_id),
    slotSummary: parseSlotSummaryEntries(
      serviceSkillValue.slot_values ?? serviceSkillValue.slot_summary,
    ),
    userInput:
      normalizeOptionalText(serviceSkillValue.user_input) ||
      normalizeOptionalText(serviceSkillValue.userInput),
  };
}

function shouldUseFallbackLabel(value: string): boolean {
  return value === UNKNOWN_SERVICE_SKILL_LABEL;
}

function shouldUseFallbackTitle(value: string): boolean {
  return value === DEFAULT_SERVICE_SKILL_TITLE;
}

export function mergeAutomationServiceSkillContexts(
  primary: AutomationServiceSkillContext | null,
  fallback: AutomationServiceSkillContext | null,
): AutomationServiceSkillContext | null {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }

  return {
    id: primary.id || fallback.id,
    title: shouldUseFallbackTitle(primary.title)
      ? fallback.title
      : primary.title,
    runnerLabel: shouldUseFallbackLabel(primary.runnerLabel)
      ? fallback.runnerLabel
      : primary.runnerLabel,
    executionLocationLabel: shouldUseFallbackLabel(
      primary.executionLocationLabel,
    )
      ? fallback.executionLocationLabel
      : primary.executionLocationLabel,
    sourceLabel: shouldUseFallbackLabel(primary.sourceLabel)
      ? fallback.sourceLabel
      : primary.sourceLabel,
    theme: primary.theme || fallback.theme,
    contentId: primary.contentId || fallback.contentId,
    slotSummary: primary.slotSummary.length
      ? primary.slotSummary
      : fallback.slotSummary,
    userInput: primary.userInput || fallback.userInput,
  };
}

export function resolveServiceSkillContextFromMetadataRecord(
  metadata: Record<string, unknown>,
  options?: {
    contentId?: string | null;
  },
): AutomationServiceSkillContext | null {
  const nestedRequestMetadata = isRecord(metadata.request_metadata)
    ? metadata.request_metadata
    : null;
  const explicitContentId = normalizeOptionalText(options?.contentId);

  return (
    resolveServiceSkillContextFromRecord(metadata, explicitContentId) ||
    (nestedRequestMetadata
      ? resolveServiceSkillContextFromRecord(
          nestedRequestMetadata,
          explicitContentId,
        )
      : null)
  );
}

export function resolveServiceSkillAutomationContext(
  payload: AutomationPayload,
): AutomationServiceSkillContext | null {
  if (payload.kind !== "agent_turn" || !isRecord(payload.request_metadata)) {
    return null;
  }
  return resolveServiceSkillContextFromRecord(
    payload.request_metadata,
    payload.content_id,
  );
}
