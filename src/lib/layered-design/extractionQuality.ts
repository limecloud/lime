import type {
  GeneratedDesignAsset,
  ImageLayer,
  LayeredDesignExtraction,
  LayeredDesignExtractionCandidate,
} from "./types";

export type LayeredDesignExtractionQualityLevel =
  | "ready"
  | "review"
  | "high_risk";

export type LayeredDesignExtractionQualityFindingSeverity =
  | "info"
  | "warning"
  | "critical";

export interface LayeredDesignExtractionQualityFinding {
  id: string;
  severity: LayeredDesignExtractionQualityFindingSeverity;
  title: string;
  message: string;
}

export interface LayeredDesignExtractionQualityAssessment {
  score: number;
  level: LayeredDesignExtractionQualityLevel;
  label: string;
  summary: string;
  selectedCandidateCount: number;
  totalCandidateCount: number;
  findings: LayeredDesignExtractionQualityFinding[];
}

export interface EvaluateLayeredDesignExtractionQualityOptions {
  assets?: readonly GeneratedDesignAsset[];
}

const SUBJECT_MASK_NEAR_EMPTY_COVERAGE_MAX = 0.005;
const SUBJECT_MASK_LOW_COVERAGE_MAX = 0.03;
const SUBJECT_MASK_HIGH_COVERAGE_MIN = 0.97;
const CLEAN_PLATE_CRITICAL_FILL_RATIO_MAX = 0.005;
const CLEAN_PLATE_LOW_FILL_RATIO_MAX = 0.5;

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function isImageCandidate(candidate: LayeredDesignExtractionCandidate): boolean {
  return candidate.layer.type === "image" || candidate.layer.type === "effect";
}

function hasMaskBackedLayer(candidate: LayeredDesignExtractionCandidate): boolean {
  const layer = candidate.layer;
  if (layer.type !== "image" && layer.type !== "effect") {
    return false;
  }

  return Boolean((layer as ImageLayer).maskAssetId) || layer.alphaMode === "mask";
}

function createAssetLookup(
  assets: readonly GeneratedDesignAsset[] | undefined,
): Map<string, GeneratedDesignAsset> {
  return new Map((assets ?? []).map((asset) => [asset.id, asset]));
}

function findCandidatePrimaryAsset(
  candidate: LayeredDesignExtractionCandidate,
  assetsById: ReadonlyMap<string, GeneratedDesignAsset>,
): GeneratedDesignAsset | null {
  if (candidate.layer.type === "image" || candidate.layer.type === "effect") {
    return assetsById.get(candidate.layer.assetId) ?? null;
  }

  return (
    candidate.assetIds
      .map((assetId) => assetsById.get(assetId))
      .find((asset): asset is GeneratedDesignAsset => Boolean(asset)) ?? null
  );
}

function findCleanPlateAsset(
  extraction: LayeredDesignExtraction,
  assetsById: ReadonlyMap<string, GeneratedDesignAsset>,
): GeneratedDesignAsset | null {
  const assetId = extraction.cleanPlate.assetId;
  return assetId ? assetsById.get(assetId) ?? null : null;
}

function hasProductionReadyCapability(
  extraction: LayeredDesignExtraction,
  kind: "subject_matting" | "clean_plate",
): boolean {
  return Boolean(
    extraction.analysis?.providerCapabilities?.some(
      (capability) =>
        capability.kind === kind &&
        capability.quality?.productionReady === true,
    ),
  );
}

function hasSucceededModelSlotExecution(
  params: Record<string, unknown> | undefined,
  slotKind: "subject_matting" | "clean_plate",
): boolean {
  const execution = readRecord(params?.modelSlotExecution);
  if (!execution) {
    return false;
  }

  const status = readString(execution.status);
  return (
    readString(execution.slotKind) === slotKind &&
    (status === "succeeded" || status === "fallback_succeeded")
  );
}

function resolveLevel(params: {
  score: number;
  findings: readonly LayeredDesignExtractionQualityFinding[];
}): LayeredDesignExtractionQualityLevel {
  if (
    params.score < 50 ||
    params.findings.some((finding) => finding.severity === "critical")
  ) {
    return "high_risk";
  }

  if (
    params.score < 75 ||
    params.findings.some((finding) => finding.severity === "warning")
  ) {
    return "review";
  }

  return "ready";
}

function resolveLevelLabel(level: LayeredDesignExtractionQualityLevel): string {
  switch (level) {
    case "ready":
      return "可进入编辑";
    case "review":
      return "需要人工复核";
    case "high_risk":
      return "高风险";
  }
}

function buildSummary(params: {
  level: LayeredDesignExtractionQualityLevel;
  selectedCandidateCount: number;
  totalCandidateCount: number;
  findingCount: number;
}): string {
  const base = `已选择 ${params.selectedCandidateCount}/${params.totalCandidateCount} 个候选层`;

  switch (params.level) {
    case "ready":
      return `${base}，拆层结果基本可进入编辑。`;
    case "review":
      return `${base}，仍有 ${params.findingCount} 项需要进入编辑前复核。`;
    case "high_risk":
      return `${base}，关键拆层能力缺失，建议先重跑 analyzer 或仅保留原图。`;
  }
}

export function evaluateLayeredDesignExtractionQuality(
  extraction: LayeredDesignExtraction,
  options: EvaluateLayeredDesignExtractionQualityOptions = {},
): LayeredDesignExtractionQualityAssessment {
  const findings: LayeredDesignExtractionQualityFinding[] = [];
  const assetsById = createAssetLookup(options.assets);
  const selectedCandidates = extraction.candidates.filter(
    (candidate) => candidate.selected,
  );
  const selectedImageCandidates = selectedCandidates.filter(isImageCandidate);
  const selectedSubjectCandidates = selectedCandidates.filter(
    (candidate) => candidate.role === "subject",
  );
  const selectedTextCandidates = selectedCandidates.filter(
    (candidate) => candidate.layer.type === "text",
  );
  const lowConfidenceSelectedCandidates = selectedCandidates.filter(
    (candidate) =>
      candidate.confidence < extraction.candidateSelectionThreshold ||
      candidate.issues?.includes("low_confidence"),
  );
  const outputs = extraction.analysis?.outputs;
  const subjectMattingCapabilityProductionReady = hasProductionReadyCapability(
    extraction,
    "subject_matting",
  );
  const cleanPlateCapabilityProductionReady = hasProductionReadyCapability(
    extraction,
    "clean_plate",
  );
  let score = 100;

  if (selectedCandidates.length === 0) {
    score -= 35;
    findings.push({
      id: "no_selected_candidates",
      severity: "critical",
      title: "未选择候选层",
      message: "当前将只保留原图背景，不能验证主体移动、文字编辑或图层重排效果。",
    });
  }

  if (lowConfidenceSelectedCandidates.length > 0) {
    score -= 15;
    findings.push({
      id: "low_confidence_selected",
      severity: "warning",
      title: "包含低置信候选",
      message: `${lowConfidenceSelectedCandidates.length} 个已选候选低于默认阈值，进入编辑后需要人工核对边缘和语义。`,
    });
  }

  if (
    selectedSubjectCandidates.length > 0 &&
    !selectedSubjectCandidates.some(hasMaskBackedLayer) &&
    !outputs?.candidateMask
  ) {
    score -= 20;
    findings.push({
      id: "subject_mask_missing",
      severity: "warning",
      title: "主体 mask 缺失",
      message: "已选主体没有可核对 mask，移动主体后边缘质量和透明度需要人工确认。",
    });
  }

  if (
    selectedImageCandidates.length > 0 &&
    extraction.cleanPlate.status !== "succeeded"
  ) {
    const failed = extraction.cleanPlate.status === "failed";
    score -= failed ? 25 : 15;
    findings.push({
      id: "clean_plate_missing",
      severity: failed ? "critical" : "warning",
      title: failed ? "clean plate 失败" : "clean plate 未提供",
      message: failed
        ? "背景修补失败，移动主体或图片层时可能露出原对象空洞。"
        : "当前没有可用背景修补层，移动主体或图片层前建议重跑 analyzer。",
    });
  }

  if (!outputs?.ocrText && selectedTextCandidates.length === 0) {
    score -= 10;
    findings.push({
      id: "ocr_text_missing",
      severity: "info",
      title: "OCR TextLayer 未提供",
      message: "普通文案可能仍停留在图片层里，进入编辑后不一定能直接改字。",
    });
  }

  if (
    extraction.analysis?.providerCapabilities?.some(
      (capability) =>
        capability.quality?.requiresHumanReview ||
        capability.quality?.productionReady === false,
    )
  ) {
    score -= 10;
    findings.push({
      id: "provider_requires_review",
      severity: "warning",
      title: "能力来源需人工复核",
      message: "本轮 analyzer 使用了实验或需人工复核的能力，导出前仍应检查主体边缘、背景修补和文字结果。",
    });
  }

  const subjectHoleRepairCount = selectedSubjectCandidates.reduce(
    (sum, candidate) =>
      sum +
      (readFiniteNumber(
        findCandidatePrimaryAsset(candidate, assetsById)?.params
          ?.alphaHoleFilledPixelCount,
      ) ?? 0),
    0,
  );
  const subjectTotalPixels = selectedSubjectCandidates.reduce(
    (sum, candidate) =>
      sum +
      (readFiniteNumber(
        findCandidatePrimaryAsset(candidate, assetsById)?.params?.totalPixelCount,
      ) ?? 0),
    0,
  );
  if (subjectHoleRepairCount > 0) {
    const repairRatio =
      subjectTotalPixels > 0 ? subjectHoleRepairCount / subjectTotalPixels : 0;
    const severity =
      repairRatio >= 0.015
        ? ("warning" as const)
        : ("info" as const);
    if (severity === "warning") {
      score -= 6;
    }
    findings.push({
      id: "subject_alpha_holes_repaired",
      severity,
      title: "主体 alpha 孔洞已修复",
      message: `${Math.round(subjectHoleRepairCount)} 个主体透明孔洞像素已由 matting 后处理填补，进入编辑后仍建议核对主体内部细节。`,
    });
  }

  const subjectMaskCoverageIssues = selectedSubjectCandidates
    .map((candidate) => {
      const asset = findCandidatePrimaryAsset(candidate, assetsById);
      const foregroundPixelCount = readFiniteNumber(
        asset?.params?.foregroundPixelCount,
      );
      const totalPixelCount = readFiniteNumber(asset?.params?.totalPixelCount);
      if (
        foregroundPixelCount === null ||
        totalPixelCount === null ||
        totalPixelCount <= 0
      ) {
        return null;
      }

      return {
        candidate,
        coverage: foregroundPixelCount / totalPixelCount,
      };
    })
    .filter(
      (
        item,
      ): item is {
        candidate: LayeredDesignExtractionCandidate;
        coverage: number;
      } =>
        item !== null &&
        (item.coverage <= SUBJECT_MASK_LOW_COVERAGE_MAX ||
          item.coverage >= SUBJECT_MASK_HIGH_COVERAGE_MIN),
    );
  if (subjectMaskCoverageIssues.length > 0) {
    const hasNearEmptyMask = subjectMaskCoverageIssues.some(
      (issue) => issue.coverage <= SUBJECT_MASK_NEAR_EMPTY_COVERAGE_MAX,
    );
    score -= hasNearEmptyMask ? 25 : 8;
    findings.push({
      id: "subject_mask_coverage_extreme",
      severity: hasNearEmptyMask ? "critical" : "warning",
      title: "主体 mask 覆盖异常",
      message: subjectMaskCoverageIssues
        .map(
          (issue) =>
            `${issue.candidate.layer.name} 的前景覆盖约 ${formatPercent(
              issue.coverage,
            )}`,
        )
        .join("；") +
        "，进入编辑前应核对主体是否被过度抠除或背景是否被整块带入。",
    });
  }

  const subjectMaskEllipseFallbackIssues = selectedSubjectCandidates
    .map((candidate) => {
      const asset = findCandidatePrimaryAsset(candidate, assetsById);
      if (readBoolean(asset?.params?.ellipseFallbackApplied) !== true) {
        return null;
      }

      const detectedForegroundPixelCount = readFiniteNumber(
        asset?.params?.detectedForegroundPixelCount,
      );
      const totalPixelCount = readFiniteNumber(asset?.params?.totalPixelCount);
      const detectedCoverage =
        detectedForegroundPixelCount !== null &&
        totalPixelCount !== null &&
        totalPixelCount > 0
          ? detectedForegroundPixelCount / totalPixelCount
          : null;

      return {
        candidate,
        detectedCoverage,
      };
    })
    .filter(
      (
        item,
      ): item is {
        candidate: LayeredDesignExtractionCandidate;
        detectedCoverage: number | null;
      } => item !== null,
    );
  if (subjectMaskEllipseFallbackIssues.length > 0) {
    score -= 25;
    findings.push({
      id: "subject_mask_ellipse_fallback",
      severity: "critical",
      title: "主体 mask 使用兜底椭圆",
      message:
        subjectMaskEllipseFallbackIssues
          .map((issue) => {
            const coverage =
              issue.detectedCoverage === null
                ? "未记录有效前景覆盖"
                : `检测前景覆盖约 ${formatPercent(issue.detectedCoverage)}`;
            return `${issue.candidate.layer.name} ${coverage}`;
          })
          .join("；") +
        "，当前主体 mask 是猜测式兜底结果，建议重跑 analyzer 或仅保留原图后再编辑。",
    });
  }

  const productionSubjectMetadataMissing = selectedSubjectCandidates
    .map((candidate) => {
      const asset = findCandidatePrimaryAsset(candidate, assetsById);
      if (
        !subjectMattingCapabilityProductionReady ||
        !hasSucceededModelSlotExecution(asset?.params, "subject_matting")
      ) {
        return null;
      }

      const missingKeys = [
        readFiniteNumber(asset?.params?.foregroundPixelCount) === null
          ? "foregroundPixelCount"
          : null,
        readFiniteNumber(asset?.params?.totalPixelCount) === null
          ? "totalPixelCount"
          : null,
        readBoolean(asset?.params?.ellipseFallbackApplied) === null
          ? "ellipseFallbackApplied"
          : null,
      ].filter((key): key is string => Boolean(key));

      return missingKeys.length > 0
        ? {
            candidate,
            missingKeys,
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        candidate: LayeredDesignExtractionCandidate;
        missingKeys: string[];
      } => item !== null,
    );
  if (productionSubjectMetadataMissing.length > 0) {
    score -= 10;
    findings.push({
      id: "subject_model_slot_quality_metadata_missing",
      severity: "warning",
      title: "主体 model slot 缺少质量元数据",
      message:
        productionSubjectMetadataMissing
          .map(
            (item) =>
              `${item.candidate.layer.name} 缺少 ${item.missingKeys.join(
                " / ",
              )}`,
          )
          .join("；") +
        "，该主体来自生产级 model slot，但缺少可验证 mask 覆盖和兜底状态的元数据，导出前需要人工复核。",
    });
  }

  const cleanPlateAsset = findCleanPlateAsset(extraction, assetsById);
  if (
    cleanPlateCapabilityProductionReady &&
    hasSucceededModelSlotExecution(cleanPlateAsset?.params, "clean_plate")
  ) {
    const missingKeys = [
      readFiniteNumber(cleanPlateAsset?.params?.filledPixelCount) === null
        ? "filledPixelCount"
        : null,
      readFiniteNumber(cleanPlateAsset?.params?.totalSubjectPixelCount) === null
        ? "totalSubjectPixelCount"
        : null,
      readBoolean(cleanPlateAsset?.params?.maskApplied) === null
        ? "maskApplied"
        : null,
    ].filter((key): key is string => Boolean(key));

    if (missingKeys.length > 0) {
      score -= 10;
      findings.push({
        id: "clean_plate_model_slot_quality_metadata_missing",
        severity: "warning",
        title: "clean plate model slot 缺少质量元数据",
        message: `生产级 clean plate model slot 缺少 ${missingKeys.join(
          " / ",
        )}，无法确认背景修补是否覆盖主体目标区域，导出前需要人工复核。`,
      });
    }
  }

  const cleanPlateFilledPixelCount = readFiniteNumber(
    cleanPlateAsset?.params?.filledPixelCount,
  );
  const cleanPlateTotalSubjectPixelCount = readFiniteNumber(
    cleanPlateAsset?.params?.totalSubjectPixelCount,
  );
  if (
    extraction.cleanPlate.status === "succeeded" &&
    cleanPlateFilledPixelCount !== null &&
    cleanPlateTotalSubjectPixelCount !== null &&
    cleanPlateTotalSubjectPixelCount > 0
  ) {
    const fillRatio =
      cleanPlateFilledPixelCount / cleanPlateTotalSubjectPixelCount;
    if (fillRatio <= CLEAN_PLATE_LOW_FILL_RATIO_MAX) {
      const severity =
        fillRatio <= CLEAN_PLATE_CRITICAL_FILL_RATIO_MAX
          ? ("critical" as const)
          : ("warning" as const);
      score -= severity === "critical" ? 25 : 10;
      findings.push({
        id: "clean_plate_fill_coverage_low",
        severity,
        title: "clean plate 修补覆盖不足",
        message: `clean plate 只修补了 ${Math.round(
          cleanPlateFilledPixelCount,
        )}/${Math.round(
          cleanPlateTotalSubjectPixelCount,
        )} 个目标像素（约 ${formatPercent(
          fillRatio,
        )}），移动主体后可能露出原图残影或空洞。`,
      });
    }
  }

  const cleanPlateMaskApplied = readBoolean(
    cleanPlateAsset?.params?.maskApplied,
  );
  if (
    extraction.cleanPlate.status === "succeeded" &&
    cleanPlateMaskApplied === false &&
    selectedSubjectCandidates.some(hasMaskBackedLayer)
  ) {
    score -= 8;
    findings.push({
      id: "clean_plate_mask_not_applied",
      severity: "warning",
      title: "clean plate 未使用主体 mask",
      message:
        "已选主体带有 mask，但 clean plate 元数据表示修补时未使用该 mask；移动主体后需要重点核对原位置边缘。",
    });
  }

  const cleanPlateHaloExpandedPixelCount = readFiniteNumber(
    cleanPlateAsset?.params?.haloExpandedPixelCount,
  );
  if (
    extraction.cleanPlate.status === "succeeded" &&
    (cleanPlateHaloExpandedPixelCount ?? 0) > 0
  ) {
    score -= 5;
    findings.push({
      id: "clean_plate_halo_repaired",
      severity: "warning",
      title: "clean plate 边缘残影已修补",
      message: `${Math.round(cleanPlateHaloExpandedPixelCount ?? 0)} 个 mask 边缘 halo 像素已参与背景修补，移动主体后应重点核对原位置边缘。`,
    });
  }

  const normalizedScore = clampScore(score);
  const level = resolveLevel({ score: normalizedScore, findings });

  return {
    score: normalizedScore,
    level,
    label: resolveLevelLabel(level),
    summary: buildSummary({
      level,
      selectedCandidateCount: selectedCandidates.length,
      totalCandidateCount: extraction.candidates.length,
      findingCount: findings.length,
    }),
    selectedCandidateCount: selectedCandidates.length,
    totalCandidateCount: extraction.candidates.length,
    findings,
  };
}
