import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

const REASONING_TOKEN_PATTERN = /(^|[._/-])(thinking|reasoning)(?=$|[._/-])/i;

export type ThinkingResolveReason =
  | "matched"
  | "no_variant"
  | "already_reasoning";

export type ThinkingOffResolveReason =
  | "restored_base"
  | "already_non_reasoning"
  | "keep_current";

export interface ThinkingResolveResult {
  targetModelId: string;
  switched: boolean;
  reason: ThinkingResolveReason;
}

export interface ThinkingOffResolveResult {
  targetModelId: string;
  switched: boolean;
  reason: ThinkingOffResolveReason;
}

interface ResolveThinkingModelParams {
  currentModelId: string;
  models: EnhancedModelMetadata[];
}

interface ResolveThinkingOffModelParams {
  currentModelId: string;
  models: EnhancedModelMetadata[];
  rememberedBaseModel?: string | null;
}

const normalizeModelId = (modelId: string): string =>
  modelId.trim().toLowerCase();

const normalizeBaseModelKey = (modelId: string): string => {
  return normalizeModelId(modelId)
    .replace(/([._-]?)(thinking|reasoning)(?=$|[._-])/gi, "")
    .replace(/[._-]{2,}/g, "-")
    .replace(/[._-]+$/g, "")
    .trim();
};

const findModelMeta = (
  modelId: string,
  models: EnhancedModelMetadata[],
): EnhancedModelMetadata | undefined => {
  const normalized = normalizeModelId(modelId);
  return models.find((model) => normalizeModelId(model.id) === normalized);
};

const modelHasReasoningCapability = (
  model: EnhancedModelMetadata | undefined,
): boolean => {
  if (!model) return false;
  if (model.capabilities.reasoning) return true;
  if (REASONING_TOKEN_PATTERN.test(model.id)) return true;
  if (
    model.display_name &&
    REASONING_TOKEN_PATTERN.test(model.display_name.toLowerCase())
  ) {
    return true;
  }
  return false;
};

const compareReleaseDateDesc = (
  a: EnhancedModelMetadata,
  b: EnhancedModelMetadata,
): number => {
  if (a.release_date && b.release_date) {
    return b.release_date.localeCompare(a.release_date);
  }
  if (a.release_date && !b.release_date) return -1;
  if (!a.release_date && b.release_date) return 1;
  return 0;
};

const sortReasoningCandidates = (
  candidates: EnhancedModelMetadata[],
  currentModelId: string,
): EnhancedModelMetadata[] => {
  const normalizedCurrentId = normalizeModelId(currentModelId);
  const exactPreferredIds = new Set(
    [
      `${normalizedCurrentId}-thinking`,
      `${normalizedCurrentId}_thinking`,
      `${normalizedCurrentId}-reasoning`,
      `${normalizedCurrentId}_reasoning`,
    ].map(normalizeModelId),
  );

  return [...candidates].sort((a, b) => {
    const aExact = exactPreferredIds.has(normalizeModelId(a.id));
    const bExact = exactPreferredIds.has(normalizeModelId(b.id));
    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }

    if (a.is_latest !== b.is_latest) {
      return a.is_latest ? -1 : 1;
    }

    const byDate = compareReleaseDateDesc(a, b);
    if (byDate !== 0) return byDate;

    return a.id.localeCompare(b.id);
  });
};

const findRestorableBaseModel = (
  currentModelId: string,
  models: EnhancedModelMetadata[],
): EnhancedModelMetadata | null => {
  const currentBaseKey = normalizeBaseModelKey(currentModelId);
  const nonReasoningCandidates = models.filter(
    (candidate) => !isReasoningModel(candidate.id, models),
  );

  const matchedCandidates = nonReasoningCandidates.filter(
    (candidate) => normalizeBaseModelKey(candidate.id) === currentBaseKey,
  );

  if (matchedCandidates.length === 0) {
    return null;
  }

  return sortReasoningCandidates(matchedCandidates, currentModelId)[0] ?? null;
};

export function isReasoningModel(
  modelId: string,
  models: EnhancedModelMetadata[],
): boolean {
  if (!modelId.trim()) return false;
  const directMatch = findModelMeta(modelId, models);
  if (modelHasReasoningCapability(directMatch)) {
    return true;
  }
  return REASONING_TOKEN_PATTERN.test(modelId.toLowerCase());
}

export function resolveThinkingModel(
  params: ResolveThinkingModelParams,
): ThinkingResolveResult {
  const { currentModelId, models } = params;
  if (!currentModelId.trim()) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "no_variant",
    };
  }

  if (isReasoningModel(currentModelId, models)) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "already_reasoning",
    };
  }

  const currentBaseKey = normalizeBaseModelKey(currentModelId);
  const reasoningCandidates = models.filter((candidate) =>
    modelHasReasoningCapability(candidate),
  );
  const matchedCandidates = reasoningCandidates.filter(
    (candidate) => normalizeBaseModelKey(candidate.id) === currentBaseKey,
  );

  if (matchedCandidates.length === 0) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "no_variant",
    };
  }

  const target = sortReasoningCandidates(matchedCandidates, currentModelId)[0];
  if (!target) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "no_variant",
    };
  }

  return {
    targetModelId: target.id,
    switched: normalizeModelId(target.id) !== normalizeModelId(currentModelId),
    reason: "matched",
  };
}

export function resolveBaseModelOnThinkingOff(
  params: ResolveThinkingOffModelParams,
): ThinkingOffResolveResult {
  const { currentModelId, models, rememberedBaseModel } = params;
  if (!currentModelId.trim()) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "keep_current",
    };
  }

  if (!isReasoningModel(currentModelId, models)) {
    return {
      targetModelId: currentModelId,
      switched: false,
      reason: "already_non_reasoning",
    };
  }

  const remembered = rememberedBaseModel?.trim();
  if (remembered) {
    const rememberedMeta = findModelMeta(remembered, models);
    if (rememberedMeta && !isReasoningModel(rememberedMeta.id, models)) {
      return {
        targetModelId: rememberedMeta.id,
        switched:
          normalizeModelId(rememberedMeta.id) !==
          normalizeModelId(currentModelId),
        reason: "restored_base",
      };
    }
  }

  const fallbackBase = findRestorableBaseModel(currentModelId, models);
  if (fallbackBase) {
    return {
      targetModelId: fallbackBase.id,
      switched:
        normalizeModelId(fallbackBase.id) !== normalizeModelId(currentModelId),
      reason: "restored_base",
    };
  }

  return {
    targetModelId: currentModelId,
    switched: false,
    reason: "keep_current",
  };
}
