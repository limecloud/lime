import type {
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import type { SkillsPageParams } from "@/types/page";
import type { CuratedTaskRecommendationSignal } from "./curatedTaskRecommendationSignals";

interface BuildSkillsPageParamsFromSceneAppExecutionOptions {
  projectId?: string | null;
  reviewSignal?: CuratedTaskRecommendationSignal | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function dedupeItems(
  items: Array<string | null | undefined>,
  maxItems = 4,
): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => normalizeOptionalText(item))
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(0, maxItems);
}

function buildDirectorySlug(
  summary: SceneAppExecutionSummaryViewModel,
  detailView: SceneAppRunDetailViewModel,
): string {
  const titleSeed = summary.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const runSeed = detailView.runId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-8);

  if (titleSeed) {
    return `${titleSeed}-${runSeed || "draft"}`.slice(0, 48);
  }

  return `saved-skill-${runSeed || "draft"}`;
}

function buildReviewDecisionSnippet(
  reviewSignal?: CuratedTaskRecommendationSignal | null,
): string | undefined {
  if (!reviewSignal || reviewSignal.source !== "review_feedback") {
    return undefined;
  }

  const title = normalizeOptionalText(reviewSignal.title);
  const summary = normalizeOptionalText(reviewSignal.summary);
  return dedupeItems([
    title ? `最近人工判断：${title}` : null,
    summary ? `判断摘要：${truncate(summary, 88)}` : null,
  ]).join(" ");
}

export function buildSkillsPageParamsFromSceneAppExecution(
  summary?: SceneAppExecutionSummaryViewModel | null,
  detailView?: SceneAppRunDetailViewModel | null,
  options: BuildSkillsPageParamsFromSceneAppExecutionOptions = {},
): SkillsPageParams | null {
  if (!summary || !detailView) {
    return null;
  }

  const projectId = normalizeOptionalText(options.projectId);
  const reviewSnippet = buildReviewDecisionSnippet(options.reviewSignal);
  const summarySnippet = truncate(summary.summary, 72);
  const deliverySnippet = truncate(detailView.deliverySummary, 72);
  const nextActionSnippet = truncate(detailView.nextAction, 72);
  const tasteSnippet = normalizeOptionalText(summary.tasteSummary);
  const feedbackSnippet =
    normalizeOptionalText(detailView.contextBaseline?.feedbackSummary) ||
    normalizeOptionalText(summary.feedbackSummary);
  const missingPartsLabel = detailView.deliveryMissingParts
    .map((item) => normalizeOptionalText(item.label))
    .filter((item): item is string => Boolean(item))
    .join("、");
  const failureSignalLabel = normalizeOptionalText(
    detailView.failureSignalLabel,
  );
  const reviewSignalSummary = normalizeOptionalText(
    options.reviewSignal?.summary,
  );

  const name = truncate(`${summary.title}复用做法`, 24);
  const sourceExcerpt = truncate(
    dedupeItems(
      [
        `场景结果：${summarySnippet}`,
        `交付状态：${deliverySnippet}`,
        reviewSnippet,
      ],
      3,
    ).join(" "),
    180,
  );

  return {
    ...(projectId ? { creationProjectId: projectId } : {}),
    initialScaffoldDraft: {
      target: "project",
      directory: buildDirectorySlug(summary, detailView),
      name,
      description: dedupeItems(
        [
          `沉淀自「${summary.title}」这轮已经进入结果消费与判断闭环的做法。`,
          `当前交付状态：${deliverySnippet}`,
          reviewSnippet,
        ],
        3,
      ).join(" "),
      whenToUse: dedupeItems([
        `当你需要继续产出“${summary.title}”这类${summary.businessLabel}结果时使用。`,
        `适合继续沿用这轮已验证过的 ${summary.executionChainLabel} 执行路径与当前结果交付约定。`,
        summary.referenceCount > 0
          ? `当前这轮已经验证过 ${summary.referenceCount} 条参考对象，适合在相近题材、平台或项目约束下继续复用。`
          : null,
        reviewSnippet,
      ]),
      inputs: dedupeItems(
        [
          `目标与结果方向：${summarySnippet}`,
          `执行骨架：${summary.executionChainLabel}`,
          summary.referenceCount > 0
            ? `参考对象：${summary.referenceCount} 条参考对象已被验证可继续沿用。`
            : "参考对象：按当前项目上下文补充最关键的素材、示例或历史结果。",
          reviewSignalSummary
            ? `人工判断：${truncate(reviewSignalSummary, 88)}`
            : null,
          tasteSnippet ? `风格摘要：${truncate(tasteSnippet, 72)}` : null,
          feedbackSnippet ? `最近反馈：${truncate(feedbackSnippet, 72)}` : null,
        ],
        5,
      ),
      outputs: dedupeItems([
        `交付一份与“${summary.title}”同类型、可直接继续消费的结果。`,
        `结果状态参考：${deliverySnippet}`,
        `后续建议：${nextActionSnippet}`,
      ]),
      steps: dedupeItems([
        "先确认这次任务是否仍适合同一条场景执行路径与当前结果交付约定。",
        "沿用当前已验证过的参考对象、风格摘要与项目结果基线，补齐最少必要输入。",
        "输出后按当前结果判断线索与人工判断结论，继续进入复核、发布或下一轮生成。",
      ]),
      fallbackStrategy: dedupeItems([
        missingPartsLabel
          ? `如果仍缺少${missingPartsLabel}，先补齐缺失部件，再把整套做法沉淀下来。`
          : null,
        failureSignalLabel
          ? `如果再次出现${failureSignalLabel}，先回看证据与结果材料，不要直接放大复用。`
          : null,
        reviewSignalSummary
          ? `如果最近人工判断提出新的约束，优先按“${truncate(reviewSignalSummary, 72)}”处理后再继续复用。`
          : "如果结果再次偏离目标，先重新确认受众、平台与参考约束，再决定是否沿用整套做法。",
      ]),
      sourceMessageId: `sceneapp-run-${detailView.runId}`,
      sourceExcerpt,
    },
    initialScaffoldRequestKey: Date.now(),
  };
}
