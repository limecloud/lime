import type {
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

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
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
): LayeredDesignExtractionQualityAssessment {
  const findings: LayeredDesignExtractionQualityFinding[] = [];
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
