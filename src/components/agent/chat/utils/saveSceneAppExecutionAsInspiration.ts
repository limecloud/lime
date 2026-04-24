import { toast } from "sonner";
import { createUnifiedMemory } from "@/lib/api/unifiedMemory";
import type {
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import type { MemoryPageParams } from "@/types/page";
import {
  listCuratedTaskRecommendationSignals,
  recordCuratedTaskRecommendationSignalFromMemory,
} from "./curatedTaskRecommendationSignals";
import { buildSceneAppExecutionInspirationDraft } from "./sceneAppExecutionInspirationDraft";

interface SaveSceneAppExecutionAsInspirationParams {
  summary?: SceneAppExecutionSummaryViewModel | null;
  detailView?: SceneAppRunDetailViewModel | null;
  projectId?: string | null;
  sessionId?: string | null;
  successMessage?: string;
  insufficientMessage?: string;
  failureMessage?: string;
}

interface SavedSceneAppExecutionInspirationStateParams {
  summary?: SceneAppExecutionSummaryViewModel | null;
  detailView?: SceneAppRunDetailViewModel | null;
  projectId?: string | null;
  sessionId?: string | null;
}

export function hasSavedSceneAppExecutionAsInspiration({
  summary,
  detailView,
  projectId,
  sessionId,
}: SavedSceneAppExecutionInspirationStateParams): boolean {
  const draft = buildSceneAppExecutionInspirationDraft(summary, detailView, {
    sessionId,
  });
  if (!draft) {
    return false;
  }

  return listCuratedTaskRecommendationSignals({
    projectId,
    sessionId,
  }).some(
    (signal) =>
      signal.source === "saved_inspiration" &&
      signal.category === draft.category &&
      signal.title === draft.title,
  );
}

export function buildSceneAppExecutionInspirationLibraryPageParams({
  summary,
  detailView,
}: SavedSceneAppExecutionInspirationStateParams): MemoryPageParams {
  const draft = buildSceneAppExecutionInspirationDraft(summary, detailView);

  return {
    section: draft?.section ?? "experience",
    focusMemoryTitle: draft?.title,
    focusMemoryCategory: draft?.category,
  };
}

export async function saveSceneAppExecutionAsInspiration({
  summary,
  detailView,
  projectId,
  sessionId,
  successMessage = "已把这轮结果保存到灵感库",
  insufficientMessage = "当前这轮结果还不足以沉淀到灵感库",
  failureMessage = "保存到灵感库失败，请稍后重试",
}: SaveSceneAppExecutionAsInspirationParams): Promise<boolean> {
  const draft = buildSceneAppExecutionInspirationDraft(summary, detailView, {
    sessionId,
  });
  if (!draft) {
    toast.error(insufficientMessage);
    return false;
  }

  try {
    const memory = await createUnifiedMemory(draft.request);
    recordCuratedTaskRecommendationSignalFromMemory(memory, {
      projectId,
      sessionId,
    });
    toast.success(successMessage, {
      description: `${draft.categoryLabel} · ${draft.title}`,
    });
    return true;
  } catch (error) {
    console.error("保存到灵感库失败:", error);
    toast.error(failureMessage);
    return false;
  }
}
