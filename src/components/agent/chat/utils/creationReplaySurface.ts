import type { MemoryCategory } from "@/lib/api/unifiedMemory";
import type { CuratedTaskReferenceEntry } from "./curatedTaskReferenceSelection";
import type { CreationReplayMetadata } from "./creationReplayMetadata";
import {
  buildCuratedTaskReferenceSelectionFromCreationReplay,
  getCuratedTaskReferenceFallbackTitle,
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

interface MemoryEntrySurfaceCopy {
  eyebrow: string;
  tagsPrefix: string;
  fallbackSummary: string;
  hintWithReference: string;
  hintWithoutReference: string;
}

const MEMORY_ENTRY_SURFACE_COPY: Record<MemoryCategory, MemoryEntrySurfaceCopy> = {
  identity: {
    eyebrow: "当前带入风格参考",
    tagsPrefix: "风格标签",
    fallbackSummary: "这条风格参考会继续作为当前生成的审美基线。",
    hintWithReference: "后续结果模板会默认沿用这条风格参考。",
    hintWithoutReference: "当前生成会继续沿用这条风格参考。",
  },
  context: {
    eyebrow: "当前带入参考素材",
    tagsPrefix: "参考标签",
    fallbackSummary: "这条参考素材会继续作为当前生成的默认参考来源。",
    hintWithReference: "后续结果模板会默认把这条参考素材一起带入。",
    hintWithoutReference: "当前生成会继续沿用这条参考素材。",
  },
  preference: {
    eyebrow: "当前带入偏好基线",
    tagsPrefix: "偏好标签",
    fallbackSummary: "这条偏好基线会继续影响当前生成的取向。",
    hintWithReference: "后续结果模板会默认沿用这条偏好基线。",
    hintWithoutReference: "当前生成会继续沿用这条偏好基线。",
  },
  experience: {
    eyebrow: "当前带入成果样本",
    tagsPrefix: "成果标签",
    fallbackSummary: "这条成果样本会继续作为当前生成的效果参考。",
    hintWithReference: "后续结果模板会默认把这条成果样本一起带入。",
    hintWithoutReference: "当前生成会继续沿用这条成果样本。",
  },
  activity: {
    eyebrow: "当前带入收藏线索",
    tagsPrefix: "收藏标签",
    fallbackSummary: "这条收藏线索会继续作为当前生成的兴趣参考。",
    hintWithReference: "后续结果模板会默认把这条收藏线索一起带入。",
    hintWithoutReference: "当前生成会继续沿用这条收藏线索。",
  },
};

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

function getMemoryEntrySurfaceCopy(
  category: MemoryCategory,
): MemoryEntrySurfaceCopy {
  return MEMORY_ENTRY_SURFACE_COPY[category];
}

function buildMemoryEntrySummary(
  creationReplay: Extract<CreationReplayMetadata, { kind: "memory_entry" }>,
): string {
  const surfaceCopy = getMemoryEntrySurfaceCopy(creationReplay.data.category);
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
    return `${surfaceCopy.tagsPrefix}：${tags.join("、")}`;
  }

  return surfaceCopy.fallbackSummary;
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
    const surfaceCopy = getMemoryEntrySurfaceCopy(creationReplay.data.category);
    const badgeLabel = getCuratedTaskReferenceCategoryLabel(
      creationReplay.data.category,
    );
    const title =
      normalizeOptionalText(creationReplay.data.title) ||
      getCuratedTaskReferenceFallbackTitle(creationReplay.data.category);

    return {
      kind: creationReplay.kind,
      eyebrow: surfaceCopy.eyebrow,
      badgeLabel,
      title,
      summary: buildMemoryEntrySummary(creationReplay),
      hint:
        referenceSelection.referenceMemoryIds.length > 0
          ? surfaceCopy.hintWithReference
          : surfaceCopy.hintWithoutReference,
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
