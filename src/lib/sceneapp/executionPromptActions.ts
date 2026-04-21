import type { SceneAppRunDetailViewModel } from "./product";

export type SceneAppExecutionPromptActionTone =
  | "positive"
  | "neutral"
  | "warning";

export interface SceneAppExecutionPromptAction {
  key:
    | "fill_missing_parts"
    | "publish_check"
    | "publish_prepare"
    | "channel_preview"
    | "upload_prepare";
  label: string;
  helperText: string;
  prompt: string;
  tone: SceneAppExecutionPromptActionTone;
  disabledReason?: string;
}

function resolvePrimaryResultSummary(
  detailView: SceneAppRunDetailViewModel,
): {
  label: string;
  pathLabel?: string;
} | null {
  const primaryEntry =
    detailView.deliveryArtifactEntries.find((entry) => entry.isPrimary) ??
    detailView.deliveryArtifactEntries[0] ??
    null;
  if (!primaryEntry) {
    return null;
  }

  return {
    label: primaryEntry.label,
    pathLabel: primaryEntry.pathLabel,
  };
}

function buildResultContextSentence(detailView: SceneAppRunDetailViewModel): string {
  const primaryResult = resolvePrimaryResultSummary(detailView);
  if (!primaryResult) {
    return "当前这轮结果";
  }

  if (primaryResult.pathLabel?.trim()) {
    return `当前这轮结果里的主稿「${primaryResult.label}」（项目文件：${primaryResult.pathLabel.trim()}）`;
  }

  return `当前这轮结果里的主稿「${primaryResult.label}」`;
}

export function buildSceneAppExecutionPromptActions(
  detailView: SceneAppRunDetailViewModel,
): SceneAppExecutionPromptAction[] {
  const actions: SceneAppExecutionPromptAction[] = [];
  const missingParts = detailView.deliveryMissingParts.map((part) => part.label);
  const missingPartsSummary = missingParts.join("、");
  const resultContext = buildResultContextSentence(detailView);
  const failureSignalLabel = detailView.failureSignalLabel?.trim() || "";
  const publishFlowDisabledReason =
    missingParts.length > 0
      ? `当前还缺 ${missingPartsSummary}`
      : failureSignalLabel
        ? `当前还有${failureSignalLabel}`
        : undefined;

  if (missingParts.length > 0) {
    actions.push({
      key: "fill_missing_parts",
      label: "补齐缺失部件",
      helperText: `继续沿当前结果补齐 ${missingPartsSummary}，而不是重新起一条平行链路。`,
      prompt: `请基于${resultContext}继续补齐缺失部件：${missingPartsSummary}。优先复用已完成部件、当前参考和风格基线；补齐后请说明每个缺件如何回写到当前结果。`,
      tone: "warning",
    });
  }

  if (detailView.deliveryArtifactEntries.length > 0) {
    actions.push({
      key: "publish_check",
      label: "发布前检查",
      helperText:
        missingParts.length > 0
          ? "先确认标题、封面、平台合规与缺件风险，避免结果还没齐就进入发布。"
          : "先对标题、封面、平台合规与风险项做一次发布前检查。",
      prompt: `@发布合规 请基于${resultContext}做发布前检查，重点检查标题、封面、平台合规、夸大表述、风险项${
        missingParts.length > 0 ? `，以及当前仍缺的${missingPartsSummary}` : ""
      }。请输出结论、风险清单和必须补齐项。`,
      tone: "neutral",
    });

    actions.push({
      key: "publish_prepare",
      label: "进入发布整理",
      helperText: publishFlowDisabledReason
        ? `先处理${publishFlowDisabledReason}，再进入最终发布稿整理。`
        : "把当前结果包整理成可直接发布的版本，并继续沿现有发布工作流推进。",
      prompt: `@发布 请基于${resultContext}整理最终发布稿，并输出标题、摘要、封面文案、标签建议和发布备注。`,
      tone: "positive",
      disabledReason: publishFlowDisabledReason,
    });

    actions.push({
      key: "channel_preview",
      label: "生成渠道预览稿",
      helperText: publishFlowDisabledReason
        ? `先处理${publishFlowDisabledReason}，再继续看渠道首屏和封面预览。`
        : "继续复用现有发布工作流，整理一版可快速预览首屏与封面的渠道预览稿。",
      prompt: `@渠道预览 请基于${resultContext}生成渠道预览稿，优先输出标题、首屏摘要、排版层级和封面建议。`,
      tone: "neutral",
      disabledReason: publishFlowDisabledReason,
    });

    actions.push({
      key: "upload_prepare",
      label: "整理上传稿",
      helperText: publishFlowDisabledReason
        ? `先处理${publishFlowDisabledReason}，再继续整理上传稿与素材清单。`
        : "把当前结果继续整理成可直接上传的版本，并补齐素材清单与上传前检查。",
      prompt: `@上传 请基于${resultContext}整理一份可直接上传的上传稿与素材清单，优先输出标题、正文、封面说明、标签建议和上传前检查。`,
      tone: "positive",
      disabledReason: publishFlowDisabledReason,
    });
  }

  return actions;
}
