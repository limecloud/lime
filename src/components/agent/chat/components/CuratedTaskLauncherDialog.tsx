import { useEffect, useMemo, useState } from "react";
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
  hasFilledAllCuratedTaskRequiredInputs,
  resolveCuratedTaskInputValues,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";
import { listUnifiedMemories } from "@/lib/api/unifiedMemory";
import { cn } from "@/lib/utils";
import {
  buildCuratedTaskReferenceEntries,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";

interface CuratedTaskLauncherDialogProps {
  open: boolean;
  task: CuratedTaskTemplateItem | null;
  initialInputValues?: CuratedTaskInputValues | null;
  initialReferenceMemoryIds?: string[] | null;
  initialReferenceEntries?: CuratedTaskReferenceEntry[] | null;
  onOpenChange: (open: boolean) => void;
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
  initialInputValues,
  initialReferenceMemoryIds,
  initialReferenceEntries,
  onOpenChange,
  onConfirm,
}: CuratedTaskLauncherDialogProps) {
  const [inputValues, setInputValues] = useState<CuratedTaskInputValues>({});
  const [referenceEntries, setReferenceEntries] = useState<
    CuratedTaskReferenceEntry[]
  >([]);
  const [selectedReferenceMemoryIds, setSelectedReferenceMemoryIds] = useState<
    string[]
  >([]);
  const [isReferenceEntriesLoading, setIsReferenceEntriesLoading] =
    useState(false);
  const [referenceEntriesError, setReferenceEntriesError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!task || !open) {
      setInputValues({});
      return;
    }

    setInputValues(
      resolveCuratedTaskInputValues({
        task,
        inputValues: initialInputValues,
      }),
    );
  }, [initialInputValues, open, task]);

  useEffect(() => {
    if (!task || !open) {
      setReferenceEntries([]);
      setSelectedReferenceMemoryIds([]);
      setIsReferenceEntriesLoading(false);
      setReferenceEntriesError(null);
      return;
    }

    const seededReferenceEntries = mergeCuratedTaskReferenceEntries(
      initialReferenceEntries ?? [],
    );
    const seededReferenceMemoryIds =
      normalizeCuratedTaskReferenceMemoryIds([
        ...(initialReferenceMemoryIds ?? []),
        ...seededReferenceEntries.map((entry) => entry.id),
      ]) ?? [];

    setReferenceEntries(seededReferenceEntries);
    setSelectedReferenceMemoryIds(
      seededReferenceMemoryIds,
    );
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

        setReferenceEntries(
          mergeCuratedTaskReferenceEntries([
            ...seededReferenceEntries,
            ...buildCuratedTaskReferenceEntries(memories),
          ]),
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setReferenceEntries([]);
        setReferenceEntriesError("暂时没拿到灵感库，仍然可以直接进入生成。");
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
  }, [initialReferenceEntries, initialReferenceMemoryIds, open, task]);

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

    return selectedReferenceMemoryIds
      .map((id) => referenceEntryMap.get(id))
      .filter((entry): entry is CuratedTaskReferenceEntry => Boolean(entry));
  }, [referenceEntries, selectedReferenceMemoryIds]);

  const missingSelectedReferenceCount =
    selectedReferenceMemoryIds.length - selectedReferenceEntries.length;

  const handleValueChange = (key: string, value: string) => {
    setInputValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleToggleReferenceEntry = (entryId: string) => {
    setSelectedReferenceMemoryIds((current) => {
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
      referenceMemoryIds: selectedReferenceMemoryIds,
      referenceEntries: selectedReferenceEntries,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(780px,calc(100vw-32px))] max-w-none border-slate-200 bg-white p-0">
        {task ? (
          <div className="overflow-hidden rounded-[28px] bg-white">
            <DialogHeader className="border-b border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(255,255,255,1)_100%)] px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                  {task.badge}
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  {task.requiredInputFields.length} 项必填
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {task.outputHint}
                </span>
              </div>
              <div className="space-y-2 pt-3">
                <DialogTitle className="text-2xl font-semibold text-slate-950">
                  {task.title}
                </DialogTitle>
                <DialogDescription className="max-w-2xl leading-6 text-slate-600">
                  先补最少启动信息，再统一进入生成主执行面。{task.summary}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2">
                {task.requiredInputFields.map((field) => {
                  const fieldId = `curated-task-${task.id}-${field.key}`;
                  const value = inputValues[field.key] ?? "";
                  const commonClassName =
                    "mt-2 rounded-[18px] border-slate-200 bg-slate-50 focus-visible:ring-emerald-300";

                  return (
                    <div
                      key={field.key}
                      className={field.type === "textarea" ? "md:col-span-2" : ""}
                    >
                      <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                        <Label
                          htmlFor={fieldId}
                          className="text-sm font-semibold text-slate-900"
                        >
                          {field.label}
                        </Label>
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
                            className={`${commonClassName} min-h-[120px] resize-y`}
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

              <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                        可选灵感引用
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        最多 {MAX_REFERENCE_SELECTION_COUNT} 条
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      从灵感库最近更新里挑几条，直接带进这一轮生成
                    </div>
                    <div className="text-xs leading-5 text-slate-500">
                      这一步不强制。你可以先空着开工，也可以把风格、参考或过去成果一起带进去。
                    </div>
                  </div>
                  {selectedReferenceMemoryIds.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-slate-200"
                      onClick={() => setSelectedReferenceMemoryIds([])}
                    >
                      清空已选
                    </Button>
                  ) : null}
                </div>

                {isReferenceEntriesLoading ? (
                  <div className="mt-4 flex items-center gap-2 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" />
                    正在读取最近灵感…
                  </div>
                ) : null}

                {!isReferenceEntriesLoading && referenceEntries.length > 0 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {referenceEntries.map((entry) => {
                      const selected = selectedReferenceMemoryIds.includes(entry.id);
                      const selectionFull =
                        !selected &&
                        selectedReferenceMemoryIds.length >=
                          MAX_REFERENCE_SELECTION_COUNT;

                      return (
                        <button
                          key={entry.id}
                          type="button"
                          data-testid={`curated-task-reference-option-${entry.id}`}
                          className={cn(
                            "rounded-[22px] border px-4 py-4 text-left transition",
                            selected
                              ? "border-emerald-300 bg-emerald-50 shadow-sm shadow-emerald-950/5"
                              : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
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
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  {entry.categoryLabel}
                                </span>
                                {entry.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={`${entry.id}-${tag}`}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500"
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
                  <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    灵感库里还没有可选条目，后面补进来也可以。
                  </div>
                ) : null}

                {referenceEntriesError ? (
                  <div className="mt-4 rounded-[20px] border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {referenceEntriesError}
                  </div>
                ) : null}

                {selectedReferenceMemoryIds.length > 0 ? (
                  <div className="mt-4 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    已选择 {selectedReferenceMemoryIds.length} 条灵感引用，本轮会一起带入生成。
                    {missingSelectedReferenceCount > 0
                      ? ` 其中 ${missingSelectedReferenceCount} 条未出现在最近列表里，但发送时仍会保留。`
                      : ""}
                  </div>
                ) : null}
              </section>

              <div className="grid gap-3 md:grid-cols-3">
                <section className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    参考类型
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {task.optionalReferences.join("、")}
                  </div>
                </section>
                <section className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    会拿到
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {task.outputContract.join("、")}
                  </div>
                </section>
                <section className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    下一步
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {task.followUpActions.join("、")}
                  </div>
                </section>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 bg-slate-50/70 px-6 py-4">
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
                className="rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
                disabled={isLaunchDisabled}
                onClick={handleConfirm}
              >
                带着启动信息进入生成
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
