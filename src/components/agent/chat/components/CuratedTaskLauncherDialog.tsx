import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  findCuratedTaskTemplateById,
  hasFilledAllCuratedTaskRequiredInputs,
  resolveCuratedTaskInputValues,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";
import { listUnifiedMemories } from "@/lib/api/unifiedMemory";
import { cn } from "@/lib/utils";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import { buildReviewFeedbackProjection } from "@/components/agent/chat/utils/reviewFeedbackProjection";
import {
  buildCuratedTaskLaunchInputPrefillFromReferenceEntries,
  buildCuratedTaskReferenceEntries,
  extractCuratedTaskReferenceMemoryIds,
  getCuratedTaskReferenceSourceLabel,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";
import {
  buildSceneAppExecutionReviewPrefillHighlights,
  buildSceneAppExecutionReviewPrefillSnapshot,
} from "@/components/agent/chat/utils/sceneAppCuratedTaskReference";

interface CuratedTaskLauncherDialogProps {
  open: boolean;
  task: CuratedTaskTemplateItem | null;
  projectId?: string | null;
  sessionId?: string | null;
  initialInputValues?: CuratedTaskInputValues | null;
  initialReferenceMemoryIds?: string[] | null;
  initialReferenceEntries?: CuratedTaskReferenceEntry[] | null;
  prefillHint?: string | null;
  onOpenChange: (open: boolean) => void;
  onApplyReviewSuggestion?: (
    task: CuratedTaskTemplateItem,
    options: {
      inputValues: CuratedTaskInputValues;
      referenceSelection: CuratedTaskReferenceSelection;
    },
  ) => void;
  onConfirm: (
    task: CuratedTaskTemplateItem,
    inputValues: CuratedTaskInputValues,
    referenceSelection: CuratedTaskReferenceSelection,
  ) => void;
}

const MAX_REFERENCE_SELECTION_COUNT = 3;

export function CuratedTaskLauncherDialog({
  open,
  task,
  projectId,
  sessionId,
  initialInputValues,
  initialReferenceMemoryIds,
  initialReferenceEntries,
  prefillHint,
  onOpenChange,
  onApplyReviewSuggestion,
  onConfirm,
}: CuratedTaskLauncherDialogProps) {
  const [inputValues, setInputValues] = useState<CuratedTaskInputValues>({});
  const [referenceEntries, setReferenceEntries] = useState<
    CuratedTaskReferenceEntry[]
  >([]);
  const [selectedReferenceEntryIds, setSelectedReferenceEntryIds] = useState<
    string[]
  >([]);
  const [isReferenceEntriesLoading, setIsReferenceEntriesLoading] =
    useState(false);
  const [referenceEntriesError, setReferenceEntriesError] = useState<
    string | null
  >(null);
  const [referenceEntriesVersion, setReferenceEntriesVersion] = useState(0);
  const selectedReferenceEntryIdsRef = useRef<string[]>([]);

  const seededReferenceEntries = useMemo(
    () => mergeCuratedTaskReferenceEntries(initialReferenceEntries ?? []),
    [initialReferenceEntries],
  );
  const seededReferenceEntryIds = useMemo(
    () =>
      normalizeCuratedTaskReferenceMemoryIds([
        ...(initialReferenceMemoryIds ?? []),
        ...seededReferenceEntries.map((entry) => entry.id),
      ]) ?? [],
    [initialReferenceMemoryIds, seededReferenceEntries],
  );

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setReferenceEntriesVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    selectedReferenceEntryIdsRef.current = selectedReferenceEntryIds;
  }, [selectedReferenceEntryIds]);

  useEffect(() => {
    if (!task || !open) {
      setInputValues({});
      return;
    }

    setInputValues(
      resolveCuratedTaskInputValues({
        task,
        inputValues: buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
          taskId: task.id,
          inputValues: initialInputValues,
          referenceEntries: initialReferenceEntries,
        }),
      }),
    );
  }, [initialInputValues, initialReferenceEntries, open, task]);

  useEffect(() => {
    if (!task || !open) {
      setReferenceEntries([]);
      setSelectedReferenceEntryIds([]);
      setIsReferenceEntriesLoading(false);
      setReferenceEntriesError(null);
      return;
    }

    setReferenceEntries(seededReferenceEntries);
    setSelectedReferenceEntryIds(seededReferenceEntryIds);
    setReferenceEntriesError(null);
  }, [open, seededReferenceEntries, seededReferenceEntryIds, task]);

  useEffect(() => {
    if (!task || !open) {
      setIsReferenceEntriesLoading(false);
      return;
    }

    setIsReferenceEntriesLoading(true);
    setReferenceEntriesError(null);

    let cancelled = false;

    void listUnifiedMemories({
      archived: false,
      sort_by: "updated_at",
      order: "desc",
      limit: 12,
    })
      .then((memories) => {
        if (cancelled) {
          return;
        }

        setReferenceEntries((current) => {
          const selectedReferenceEntries = current.filter((entry) =>
            selectedReferenceEntryIdsRef.current.includes(entry.id),
          );

          return mergeCuratedTaskReferenceEntries([
            ...seededReferenceEntries,
            ...selectedReferenceEntries,
            ...buildCuratedTaskReferenceEntries(memories),
          ]);
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setReferenceEntries((current) => {
          const selectedReferenceEntries = current.filter((entry) =>
            selectedReferenceEntryIdsRef.current.includes(entry.id),
          );

          return mergeCuratedTaskReferenceEntries([
            ...seededReferenceEntries,
            ...selectedReferenceEntries,
          ]);
        });
        setReferenceEntriesError(
          "暂时没拿到最近参考列表，仍然可以直接进入生成。",
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setIsReferenceEntriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, referenceEntriesVersion, seededReferenceEntries, task]);

  const isLaunchDisabled = useMemo(() => {
    if (!task) {
      return true;
    }

    return !hasFilledAllCuratedTaskRequiredInputs({
      task,
      inputValues,
    });
  }, [inputValues, task]);

  const selectedReferenceEntries = useMemo(() => {
    const referenceEntryMap = new Map(
      referenceEntries.map((entry) => [entry.id, entry]),
    );

    return selectedReferenceEntryIds
      .map((id) => referenceEntryMap.get(id))
      .filter((entry): entry is CuratedTaskReferenceEntry => Boolean(entry));
  }, [referenceEntries, selectedReferenceEntryIds]);

  const missingSelectedReferenceCount =
    selectedReferenceEntryIds.length - selectedReferenceEntries.length;

  const requiredFieldCount = task?.requiredInputFields.length ?? 0;
  const filledRequiredFieldCount = useMemo(() => {
    if (!task) {
      return 0;
    }

    return task.requiredInputFields.filter((field) => {
      const value = inputValues[field.key];
      return typeof value === "string" && value.trim().length > 0;
    }).length;
  }, [inputValues, task]);
  const remainingRequiredFieldCount = Math.max(
    requiredFieldCount - filledRequiredFieldCount,
    0,
  );
  const launcherReadinessLabel =
    remainingRequiredFieldCount === 0
      ? "关键信息已齐，可以直接开始"
      : `还差 ${remainingRequiredFieldCount} 项关键信息`;

  const launcherOutcomeSummary = useMemo(() => {
    if (!task) {
      return "";
    }

    const followUp = task.followUpActions[0];
    if (followUp) {
      return `我会先给你 ${task.outputHint}，接着可以继续${followUp}。`;
    }

    return `我会先给你 ${task.outputHint}。`;
  }, [task]);

  const latestReviewTaskSignal = useMemo(
    () =>
      listCuratedTaskRecommendationSignals({
        projectId,
        sessionId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null,
    [projectId, sessionId],
  );
  const reviewFeedbackProjection = useMemo(() => {
    if (!task) {
      return null;
    }

    return buildReviewFeedbackProjection({
      signal: latestReviewTaskSignal,
      currentTaskId: task.id,
      currentTaskTitle: task.title,
    });
  }, [latestReviewTaskSignal, task]);
  const primarySuggestedTask = useMemo(() => {
    if (!reviewFeedbackProjection || reviewFeedbackProjection.matchedCurrentTask) {
      return null;
    }

    const suggestedTaskId = reviewFeedbackProjection.suggestedTasks[0]?.taskId;
    if (!suggestedTaskId) {
      return null;
    }

    return findCuratedTaskTemplateById(suggestedTaskId);
  }, [reviewFeedbackProjection]);

  const activeReviewBaselineSnapshot = useMemo(() => {
    if (!task) {
      return null;
    }

    const activeReferenceEntries =
      selectedReferenceEntries.length > 0
        ? selectedReferenceEntries
        : seededReferenceEntries;

    return buildSceneAppExecutionReviewPrefillSnapshot({
      referenceEntries: activeReferenceEntries,
      taskId: task.id,
    });
  }, [seededReferenceEntries, selectedReferenceEntries, task]);

  const activeReviewBaselineHighlights = useMemo(
    () =>
      buildSceneAppExecutionReviewPrefillHighlights(
        activeReviewBaselineSnapshot,
      ),
    [activeReviewBaselineSnapshot],
  );

  const activeReviewBaselineCarryHint = useMemo(() => {
    if (!activeReviewBaselineSnapshot || !task) {
      return null;
    }

    const carriedFields = task.requiredInputFields
      .filter((field) => (inputValues[field.key] ?? "").trim())
      .map((field) => field.label);
    if (carriedFields.length === 0) {
      return null;
    }

    if (task.id === "account-project-review") {
      return `下面的 ${carriedFields.join(" / ")} 已按这轮结果自动带入，你可以直接改成这次真正想复盘的版本。`;
    }

    return `下面的 ${carriedFields.join(" / ")} 已按这轮结果自动带入，你可以直接改成这次真正想推进的版本。`;
  }, [activeReviewBaselineSnapshot, inputValues, task]);

  const handleValueChange = (key: string, value: string) => {
    setInputValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleToggleReferenceEntry = (entryId: string) => {
    setSelectedReferenceEntryIds((current) => {
      if (current.includes(entryId)) {
        return current.filter((id) => id !== entryId);
      }

      if (current.length >= MAX_REFERENCE_SELECTION_COUNT) {
        return current;
      }

      return [...current, entryId];
    });
  };

  const handleConfirm = () => {
    if (!task || isLaunchDisabled) {
      return;
    }

    onConfirm(task, inputValues, {
      referenceMemoryIds:
        extractCuratedTaskReferenceMemoryIds(selectedReferenceEntries) ?? [],
      referenceEntries: selectedReferenceEntries,
    });
  };
  const handleApplyReviewSuggestion = () => {
    if (!primarySuggestedTask || !onApplyReviewSuggestion) {
      return;
    }

    onApplyReviewSuggestion(primarySuggestedTask, {
      inputValues,
      referenceSelection: {
        referenceMemoryIds:
          extractCuratedTaskReferenceMemoryIds(selectedReferenceEntries) ?? [],
        referenceEntries: selectedReferenceEntries,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))] max-w-none overflow-hidden border-slate-200 bg-white p-0">
        {task ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-white">
            <DialogHeader className="shrink-0 border-b border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,1)_100%)] px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium",
                    remainingRequiredFieldCount === 0
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {launcherReadinessLabel}
                </span>
              </div>
              <div className="space-y-2 pt-3">
                <DialogTitle className="text-[22px] font-semibold leading-8 text-slate-950">
                  {task.title}
                </DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
                  开始这一步前，我先确认几件事。{task.summary}
                </DialogDescription>
                <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3.5 py-3 text-xs leading-5 text-slate-500">
                  {launcherOutcomeSummary}
                </div>
              </div>
            </DialogHeader>

            <div
              className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
              data-testid="curated-task-launcher-scroll-body"
            >
              {prefillHint ? (
                <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs leading-5 text-emerald-700">
                  {prefillHint}
                </div>
              ) : null}
              {reviewFeedbackProjection ? (
                <div
                  className="rounded-[18px] border border-sky-200 bg-sky-50/80 px-4 py-3"
                  data-testid="curated-task-launcher-review-feedback-banner"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      围绕最近复盘
                    </span>
                    <div className="text-xs font-semibold leading-5 text-slate-900">
                      最近复盘已更新：{reviewFeedbackProjection.signal.title}
                    </div>
                  </div>
                  <div className="mt-1.5 text-xs leading-5 text-slate-600">
                    {reviewFeedbackProjection.signal.summary}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">
                    {primarySuggestedTask
                      ? `这轮复盘更适合先回到「${primarySuggestedTask.title}」，切过去后我会继续带着当前参考对象。`
                      : reviewFeedbackProjection.suggestionText}
                  </div>
                  {primarySuggestedTask && onApplyReviewSuggestion ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                        data-testid="curated-task-launcher-review-feedback-banner-action"
                        onClick={handleApplyReviewSuggestion}
                      >
                        改用「{primarySuggestedTask.title}」
                      </button>
                      <span className="text-[10px] leading-5 text-slate-500">
                        这一步已经填过的同名字段会尽量保留。
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {activeReviewBaselineSnapshot ? (
                <section
                  className="rounded-[20px] border border-emerald-200 bg-emerald-50/80 px-4 py-4"
                  data-testid="curated-task-launcher-sceneapp-baseline-card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      当前结果基线
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      项目结果
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {activeReviewBaselineSnapshot.sourceTitle}
                  </div>
                  {activeReviewBaselineHighlights.length > 0 ? (
                    <div className="mt-2 space-y-1.5 text-xs leading-5 text-emerald-900">
                      {activeReviewBaselineHighlights.map((item) => (
                        <div key={`baseline-${item}`}>{item}</div>
                      ))}
                    </div>
                  ) : null}
                  {activeReviewBaselineCarryHint ? (
                    <div className="mt-2 text-xs leading-5 text-emerald-700">
                      {activeReviewBaselineCarryHint}
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    先给我这些信息
                  </div>
                  <div className="text-[11px] text-slate-500">
                    缺的越少，起第一版越快
                  </div>
                </div>
              </section>

              <div className="grid gap-3">
                {task.requiredInputFields.map((field) => {
                  const fieldId = `curated-task-${task.id}-${field.key}`;
                  const value = inputValues[field.key] ?? "";
                  const commonClassName =
                    "mt-2 rounded-[16px] border-slate-200 bg-slate-50 focus-visible:ring-emerald-300";

                  return (
                    <div
                      key={field.key}
                    >
                      <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label
                            htmlFor={fieldId}
                            className="text-sm font-semibold text-slate-900"
                          >
                            {field.label}
                          </Label>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            必填
                          </span>
                        </div>
                        {field.helperText ? (
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            {field.helperText}
                          </div>
                        ) : null}
                        {field.type === "textarea" ? (
                          <Textarea
                            id={fieldId}
                            value={value}
                            placeholder={field.placeholder}
                            className={`${commonClassName} min-h-[112px] resize-y`}
                            onChange={(event) =>
                              handleValueChange(field.key, event.target.value)
                            }
                          />
                        ) : (
                          <Input
                            id={fieldId}
                            value={value}
                            placeholder={field.placeholder}
                            className={commonClassName}
                            onChange={(event) =>
                              handleValueChange(field.key, event.target.value)
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <section className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        最多 {MAX_REFERENCE_SELECTION_COUNT} 条
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      想的话，再带几条参考对象
                    </div>
                    <div className="text-xs leading-5 text-slate-500">
                      风格、偏好、项目结果和当前上下文都可以。不是必填，但会让这一轮更贴近你的目标。
                    </div>
                  </div>
                  {selectedReferenceEntryIds.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-slate-200"
                      onClick={() => setSelectedReferenceEntryIds([])}
                    >
                      清空已选
                    </Button>
                  ) : null}
                </div>

                {isReferenceEntriesLoading ? (
                  <div className="mt-4 flex items-center gap-2 rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" />
                    正在读取最近参考对象…
                  </div>
                ) : null}

                {!isReferenceEntriesLoading && referenceEntries.length > 0 ? (
                  <div className="mt-4 grid gap-2.5">
                    {referenceEntries.map((entry) => {
                      const selected = selectedReferenceEntryIds.includes(
                        entry.id,
                      );
                      const selectionFull =
                        !selected &&
                        selectedReferenceEntryIds.length >=
                          MAX_REFERENCE_SELECTION_COUNT;
                      const entryReviewSnapshot =
                        task
                          ? buildSceneAppExecutionReviewPrefillSnapshot({
                              referenceEntries: [entry],
                              taskId: task.id,
                            })
                          : null;
                      const entryReviewHighlights =
                        buildSceneAppExecutionReviewPrefillHighlights(
                          entryReviewSnapshot,
                        );

                      return (
                        <button
                          key={entry.id}
                          type="button"
                          data-testid={`curated-task-reference-option-${entry.id}`}
                          className={cn(
                            "rounded-[18px] border px-4 py-3.5 text-left transition",
                            selected
                              ? "border-emerald-300 bg-emerald-50 shadow-sm shadow-emerald-950/5"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                            selectionFull
                              ? "cursor-not-allowed opacity-55"
                              : "cursor-pointer",
                          )}
                          disabled={selectionFull}
                          onClick={() => handleToggleReferenceEntry(entry.id)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  {getCuratedTaskReferenceSourceLabel(entry)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  {entry.categoryLabel}
                                </span>
                                {entry.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={`${entry.id}-${tag}`}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              <div className="text-sm font-semibold text-slate-900">
                                {entry.title}
                              </div>
                              <div className="text-xs leading-5 text-slate-600">
                                {entry.summary}
                              </div>
                              {entryReviewHighlights.length > 0 ? (
                                <div className="rounded-[14px] border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-900">
                                  <div className="font-medium text-emerald-900">
                                    当前结果基线：
                                    {entryReviewSnapshot?.sourceTitle || entry.title}
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    {entryReviewHighlights.map((item) => (
                                      <div key={`${entry.id}-${item}`}>{item}</div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div
                              className={cn(
                                "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border",
                                selected
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-300 bg-white text-slate-400",
                              )}
                            >
                              {selected ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {!isReferenceEntriesLoading &&
                referenceEntries.length === 0 &&
                !referenceEntriesError ? (
                  <div className="mt-4 rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                    当前还没有可选参考对象，后面补进来也可以。
                  </div>
                ) : null}

                {referenceEntriesError ? (
                  <div className="mt-4 rounded-[18px] border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {referenceEntriesError}
                  </div>
                ) : null}

                {selectedReferenceEntryIds.length > 0 ? (
                  <div className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    已选择 {selectedReferenceEntryIds.length} 条参考对象，本轮会一起带入生成。
                    {missingSelectedReferenceCount > 0
                      ? ` 其中 ${missingSelectedReferenceCount} 条未出现在最近列表里，但发送时仍会保留。`
                      : ""}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                <div className="text-sm font-semibold text-slate-900">
                  这一轮会先拿到什么
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {task.outputContract.join("、")}
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-500">
                  {task.resultDestination}
                </div>
              </section>
            </div>

            <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-slate-200"
                onClick={() => onOpenChange(false)}
              >
                稍后再说
              </Button>
              <Button
                type="button"
                data-testid="curated-task-launcher-confirm"
                className="rounded-2xl border border-slate-900 bg-slate-900 px-4 text-white shadow-sm shadow-slate-950/10 hover:bg-slate-800"
                disabled={isLaunchDisabled}
                onClick={handleConfirm}
              >
                开始生成
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
