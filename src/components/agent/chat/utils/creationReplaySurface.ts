import type { CuratedTaskReferenceEntry } from "./curatedTaskReferenceSelection";
import type { CreationReplayMetadata } from "./creationReplayMetadata";
import {
  buildCuratedTaskReferenceSelectionFromCreationReplay,
  getCuratedTaskReferenceCategoryLabel,
} from "./curatedTaskReferenceSelection";

export interface CreationReplaySurfaceModel {
  kind: CreationReplayMetadata["kind"];
  eyebrow: string;
  badgeLabel: string;
  title: string;
  summary: string;
  hint: string;
  defaultReferenceMemoryIds: string[];
  defaultReferenceEntries: CuratedTaskReferenceEntry[];
}

function normalizeOptionalText(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildMemoryEntrySummary(
  creationReplay: Extract<CreationReplayMetadata, { kind: "memory_entry" }>,
): string {
  const summary =
    normalizeOptionalText(creationReplay.data.summary) ||
    normalizeOptionalText(creationReplay.data.content_excerpt);
  if (summary) {
    return truncateText(summary, 160);
  }

  const tags = (creationReplay.data.tags || [])
    .map((tag) => normalizeOptionalText(tag))
    .filter(Boolean)
    .slice(0, 4);
  if (tags.length > 0) {
    return `参考标签：${tags.join("、")}`;
  }

  return "这条灵感会继续作为当前生成的默认参考来源。";
}

function buildSkillScaffoldSummary(
  creationReplay: Extract<CreationReplayMetadata, { kind: "skill_scaffold" }>,
): string {
  const summary =
    normalizeOptionalText(creationReplay.data.description) ||
    normalizeOptionalText(creationReplay.data.source_excerpt);
  if (summary) {
    return truncateText(summary, 160);
  }

  const inputs = (creationReplay.data.inputs || [])
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .slice(0, 3);
  if (inputs.length > 0) {
    return `输入约束：${inputs.join("；")}`;
  }

  return "当前生成会继续沿用这份技能草稿的目标与边界。";
}

export function buildCreationReplaySurfaceModel(
  creationReplay?: CreationReplayMetadata,
): CreationReplaySurfaceModel | null {
  if (!creationReplay) {
    return null;
  }

  if (creationReplay.kind === "memory_entry") {
    const referenceSelection =
      buildCuratedTaskReferenceSelectionFromCreationReplay(creationReplay);
    const badgeLabel = getCuratedTaskReferenceCategoryLabel(
      creationReplay.data.category,
    );
    const title =
      normalizeOptionalText(creationReplay.data.title) || `${badgeLabel}灵感`;

    return {
      kind: creationReplay.kind,
      eyebrow: "当前带入灵感",
      badgeLabel,
      title,
      summary: buildMemoryEntrySummary(creationReplay),
      hint:
        referenceSelection.referenceMemoryIds.length > 0
          ? "后续结果模板会默认把它一起带入。"
          : "当前生成会继续沿用这条灵感。",
      defaultReferenceMemoryIds: referenceSelection.referenceMemoryIds,
      defaultReferenceEntries: referenceSelection.referenceEntries,
    };
  }

  const title =
    normalizeOptionalText(creationReplay.data.name) || "当前技能草稿";

  return {
    kind: creationReplay.kind,
    eyebrow: "当前带入技能草稿",
    badgeLabel: "技能草稿",
    title,
    summary: buildSkillScaffoldSummary(creationReplay),
    hint: "当前生成会继续沿用这份技能草稿的上下文。",
    defaultReferenceMemoryIds: [],
    defaultReferenceEntries: [],
  };
}
