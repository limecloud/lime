import { findCuratedTaskTemplateById } from "./curatedTaskTemplates";
import type { CuratedTaskRecommendationSignal } from "./curatedTaskRecommendationSignals";

export interface ReviewFeedbackSuggestedTask {
  taskId: string;
  title: string;
}

export interface ReviewFeedbackProjection {
  signal: CuratedTaskRecommendationSignal;
  matchedCurrentTask: boolean;
  suggestedTasks: ReviewFeedbackSuggestedTask[];
  suggestedTaskTitles: string[];
  suggestionText: string;
}

export function buildReviewFeedbackProjection(params: {
  signal: CuratedTaskRecommendationSignal | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
}): ReviewFeedbackProjection | null {
  const { signal } = params;
  if (!signal) {
    return null;
  }

  const preferredTaskIds = Array.from(
    new Set(
      (signal.preferredTaskIds ?? [])
        .map((taskId) => taskId.trim())
        .filter((taskId) => taskId.length > 0),
    ),
  );
  if (preferredTaskIds.length === 0) {
    return null;
  }

  const currentTaskId = params.currentTaskId?.trim() || "";
  const currentTaskTitle = params.currentTaskTitle?.trim() || "";
  const matchedCurrentTask =
    currentTaskId.length > 0 && preferredTaskIds.includes(currentTaskId);
  const suggestedTasks = preferredTaskIds
    .map((taskId) => {
      const title = findCuratedTaskTemplateById(taskId)?.title?.trim() || "";
      if (!title) {
        return null;
      }

      return {
        taskId,
        title,
      };
    })
    .filter(
      (task): task is ReviewFeedbackSuggestedTask => Boolean(task),
    )
    .slice(0, 2);
  const suggestedTaskTitles = suggestedTasks.map((task) => task.title);

  if (matchedCurrentTask) {
    return {
      signal,
      matchedCurrentTask: true,
      suggestedTasks,
      suggestedTaskTitles,
      suggestionText: currentTaskTitle
        ? `这轮判断仍建议围绕「${currentTaskTitle}」继续推进，可直接沿当前结果往下做。`
        : "这轮判断仍建议围绕当前这一步继续推进，可直接沿当前结果往下做。",
    };
  }

  if (suggestedTaskTitles.length === 0) {
    return null;
  }

  return {
    signal,
    matchedCurrentTask: false,
    suggestedTasks,
    suggestedTaskTitles,
    suggestionText: `这轮判断更建议优先回到「${suggestedTaskTitles.join("」或「")}」；需要切换时，可从首页“继续上次做法”接着跑。`,
  };
}
