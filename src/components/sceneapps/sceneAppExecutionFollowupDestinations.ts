import type { SceneAppRunDetailViewModel } from "@/lib/sceneapp";

export type SceneAppExecutionFollowupDestinationAction =
  | {
      kind: "review_current_project";
      label: string;
    }
  | {
      kind: "governance_action";
      label: string;
      entry: SceneAppRunDetailViewModel["governanceActionEntries"][number];
    }
  | {
      kind: "governance_artifact";
      label: string;
      entry: SceneAppRunDetailViewModel["governanceArtifactEntries"][number];
    }
  | {
      kind: "entry_action";
      label: string;
      entry: NonNullable<SceneAppRunDetailViewModel["entryAction"]>;
    }
  | {
      kind: "delivery_artifact";
      label: string;
      entry: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number];
    };

export interface SceneAppExecutionFollowupDestination {
  key: string;
  label: string;
  description: string;
  action?: SceneAppExecutionFollowupDestinationAction;
}

export function buildSceneAppExecutionFollowupDestinations(
  detailView: SceneAppRunDetailViewModel,
): SceneAppExecutionFollowupDestination[] {
  const destinations: SceneAppExecutionFollowupDestination[] = [];
  const actionKeys = new Set(
    detailView.governanceActionEntries.map((entry) => entry.key),
  );
  const artifactKinds = new Set(
    detailView.governanceArtifactEntries.map((entry) => entry.artifactRef.kind),
  );
  const weeklyReviewAction = detailView.governanceActionEntries.find(
    (entry) => entry.key === "weekly-review-pack",
  );
  const weeklyReviewArtifact =
    detailView.governanceArtifactEntries.find(
      (entry) => entry.artifactRef.kind === "review_decision_markdown",
    ) ??
    detailView.governanceArtifactEntries.find(
      (entry) => entry.artifactRef.kind === "evidence_summary",
    );
  const primaryDeliveryArtifact =
    detailView.deliveryArtifactEntries.find((entry) => entry.isPrimary) ??
    detailView.deliveryArtifactEntries[0];

  if (
    actionKeys.has("weekly-review-pack") ||
    (artifactKinds.has("evidence_summary") &&
      artifactKinds.has("review_decision_markdown"))
  ) {
    destinations.push({
      key: "weekly-review",
      label: "看结果",
      description:
        "证据摘要与人工复核已经适合拿回来回看这轮结果，方便快速判断卡点和下一步。",
      ...(weeklyReviewAction
        ? {
            action: {
              kind: "governance_action" as const,
              label: "打开结果材料",
              entry: weeklyReviewAction,
            },
          }
        : weeklyReviewArtifact
          ? {
              action: {
                kind: "governance_artifact" as const,
                label: "看结果材料",
                entry: weeklyReviewArtifact,
              },
            }
          : {}),
    });
  }

  if (
    actionKeys.has("structured-governance-pack") ||
    artifactKinds.has("review_decision_json")
  ) {
    destinations.push({
      key: "task-center",
      label: "生成",
      description:
        "这轮结果的结果记录已经整理好，后续更适合回到生成继续推进下一步。",
      action: {
        kind: "review_current_project",
        label: "继续这轮结果",
      },
    });
  }

  if (detailView.entryAction?.kind === "open_automation_job") {
    destinations.push({
      key: "automation-job",
      label: "持续流程",
      description:
        "这轮结果已经挂到持续任务，可以继续跟进调度频率、运行历史与交付状态。",
      action: {
        kind: "entry_action",
        label: "查看持续流程",
        entry: detailView.entryAction,
      },
    });
  }

  if (primaryDeliveryArtifact) {
    destinations.push({
      key: "delivery-editing",
      label: "结果编辑 / 发布",
      description:
        "主稿和结果文件已经可直接打开，适合继续编辑、复核或进入发布前处理。",
      action: {
        kind: "delivery_artifact",
        label: "打开主结果",
        entry: primaryDeliveryArtifact,
      },
    });
  }

  return destinations;
}
