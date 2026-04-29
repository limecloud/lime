import type {
  CreateUnifiedMemoryRequest,
  MemoryCategory,
} from "@/lib/api/unifiedMemory";
import type {
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import type { MemoryPageSection } from "@/types/page";

interface SceneAppExecutionInspirationDraft {
  category: MemoryCategory;
  categoryLabel: string;
  section: MemoryPageSection;
  title: string;
  request: CreateUnifiedMemoryRequest;
}

interface BuildSceneAppExecutionInspirationDraftOptions {
  sessionId?: string | null;
}

const CATEGORY: MemoryCategory = "experience";
const CATEGORY_LABEL = "成果";

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
  maxItems = 6,
): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => normalizeOptionalText(item))
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(0, maxItems);
}

function buildTitle(
  summary: SceneAppExecutionSummaryViewModel,
  detailView: SceneAppRunDetailViewModel,
): string {
  const failureLabel = normalizeOptionalText(detailView.failureSignalLabel);
  if (failureLabel) {
    return truncate(`${summary.title} · ${failureLabel}`, 28);
  }

  return truncate(`${summary.title}结果闭环`, 28);
}

function buildSummary(
  summary: SceneAppExecutionSummaryViewModel,
  detailView: SceneAppRunDetailViewModel,
): string {
  const summaryText =
    dedupeItems(
      [
        detailView.deliverySummary,
        detailView.nextAction ? `下一步：${detailView.nextAction}` : null,
        summary.scorecardAggregate?.summary,
        summary.runtimeBackflow?.summary,
        summary.summary,
      ],
      3,
    ).join("；") || `${summary.title}这轮结果已形成可复用闭环。`;

  return truncate(summaryText, 140);
}

function buildContent(
  summary: SceneAppExecutionSummaryViewModel,
  detailView: SceneAppRunDetailViewModel,
): string {
  const lines = dedupeItems(
    [
      `场景：${summary.title}`,
      `业务类型：${summary.businessLabel} / ${summary.typeLabel}`,
      `结果摘要：${summary.summary}`,
      `当前交付：${detailView.deliverySummary}`,
      `建议下一步：${detailView.nextAction}`,
      detailView.deliveryMissingParts.length > 0
        ? `待补部件：${detailView.deliveryMissingParts
            .map((item) => item.label)
            .join("、")}`
        : null,
      detailView.failureSignalLabel
        ? `当前信号：${detailView.failureSignalLabel}`
        : null,
      `执行主链：${summary.executionChainLabel}`,
      summary.referenceCount > 0
        ? `当前带入：${summary.referenceCount} 条参考对象`
        : "当前带入：本轮主要依赖当前输入与项目上下文",
      summary.tasteSummary ? `风格摘要：${summary.tasteSummary}` : null,
      detailView.contextBaseline?.feedbackSummary || summary.feedbackSummary
        ? `最近反馈：${
            detailView.contextBaseline?.feedbackSummary ||
            summary.feedbackSummary
          }`
        : null,
      summary.runtimeBackflow?.summary
        ? `运行态回流：${summary.runtimeBackflow.summary}`
        : null,
      summary.scorecardAggregate?.summary
        ? `当前判断：${summary.scorecardAggregate.summary}`
        : null,
    ],
    12,
  );

  return truncate(lines.join("\n"), 4000);
}

function buildTags(
  summary: SceneAppExecutionSummaryViewModel,
  detailView: SceneAppRunDetailViewModel,
): string[] {
  return dedupeItems([
    summary.businessLabel,
    summary.typeLabel,
    summary.deliveryContractLabel,
    detailView.failureSignalLabel,
    summary.runtimeBackflow?.topFailureSignalLabel,
    summary.scorecardAggregate?.statusLabel,
  ]);
}

export function buildSceneAppExecutionInspirationDraft(
  summary?: SceneAppExecutionSummaryViewModel | null,
  detailView?: SceneAppRunDetailViewModel | null,
  options: BuildSceneAppExecutionInspirationDraftOptions = {},
): SceneAppExecutionInspirationDraft | null {
  if (!summary || !detailView) {
    return null;
  }

  const title = buildTitle(summary, detailView);
  const summaryText = buildSummary(summary, detailView);

  return {
    category: CATEGORY,
    categoryLabel: CATEGORY_LABEL,
    section: CATEGORY,
    title,
    request: {
      session_id:
        normalizeOptionalText(options.sessionId) ||
        normalizeOptionalText(detailView.runId) ||
        normalizeOptionalText(summary.sceneappId) ||
        title,
      title,
      content: buildContent(summary, detailView),
      summary: summaryText,
      category: CATEGORY,
      tags: buildTags(summary, detailView),
      confidence: 0.9,
      importance: 8,
    },
  };
}
