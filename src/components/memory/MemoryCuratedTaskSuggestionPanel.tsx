import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildCuratedTaskRecentUsageDescription,
  getCuratedTaskOutputDestination,
  resolveCuratedTaskTemplateLaunchPrefill,
  summarizeCuratedTaskFollowUpActions,
  summarizeCuratedTaskOutputContract,
  summarizeCuratedTaskRequiredInputs,
  type CuratedTaskTemplateItem,
  type FeaturedCuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";

const BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";
const EMERALD_BUTTON_CLASS_NAME =
  "border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 hover:text-white";
const EMERALD_OUTLINE_BADGE_CLASS_NAME =
  "border-emerald-200 bg-white text-emerald-700";

interface MemoryCuratedTaskSuggestionPanelProps {
  tasks: FeaturedCuratedTaskTemplateItem[];
  referenceEntryCount: number;
  referenceSummary?: string;
  emptyState: string;
  gridClassName?: string;
  panelTestId?: string;
  variant?: "default" | "compact";
  contextCard?: {
    badgeLabel: string;
    title: string;
    summary?: string;
  };
  onStartTask: (task: CuratedTaskTemplateItem) => void;
}

export function MemoryCuratedTaskSuggestionPanel(
  props: MemoryCuratedTaskSuggestionPanelProps,
) {
  const compact = props.variant === "compact";

  return (
    <div className="space-y-4" data-testid={props.panelTestId}>
      {props.contextCard ? (
        <article className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-white text-emerald-700"
            >
              {props.contextCard.badgeLabel}
            </Badge>
            <h3 className="text-sm font-semibold text-slate-900">
              {props.contextCard.title}
            </h3>
          </div>
          {props.contextCard.summary ? (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
              {props.contextCard.summary}
            </p>
          ) : null}
        </article>
      ) : null}

      {props.tasks.length > 0 ? (
        <div
          className={
            props.gridClassName ??
            (compact ? "grid gap-3 xl:grid-cols-3" : "grid gap-4 xl:grid-cols-3")
          }
        >
          {props.tasks.map((featured) => {
            const task = featured.template;
            const launchPrefill = resolveCuratedTaskTemplateLaunchPrefill(task);
            const recentUsageDescription =
              buildCuratedTaskRecentUsageDescription({
                task,
                prefill: launchPrefill,
              });

            return (
              <article
                key={task.id}
                data-testid={
                  props.panelTestId
                    ? `${props.panelTestId}-task-${task.id}`
                    : undefined
                }
                className={cn(
                  "flex h-full flex-col border border-slate-200 bg-slate-50/70",
                  compact ? "rounded-2xl p-3.5" : "rounded-3xl p-4",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-sky-50 text-sky-700"
                  >
                    {featured.badgeLabel}
                  </Badge>
                  {props.referenceEntryCount > 0 ? (
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {props.referenceEntryCount} 条参考对象
                    </Badge>
                  ) : null}
                </div>

                <div className={cn("space-y-2.5", compact ? "mt-2.5" : "mt-3")}>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {task.title}
                    </h3>
                    <p
                      className={cn(
                        "mt-1 text-sm text-slate-600",
                        compact ? "line-clamp-2 leading-5" : "leading-6",
                      )}
                    >
                      {task.summary}
                    </p>
                  </div>

                  {featured.reasonSummary ? (
                    <p
                      className={cn(
                        "text-[11px] text-slate-500",
                        compact ? "line-clamp-2 leading-5" : "leading-5",
                      )}
                    >
                      {featured.reasonSummary}
                    </p>
                  ) : null}

                  {compact ? (
                    recentUsageDescription || props.referenceSummary ? (
                      <p className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                        {recentUsageDescription || props.referenceSummary}
                      </p>
                    ) : null
                  ) : recentUsageDescription ? (
                    <p className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                      {recentUsageDescription}
                    </p>
                  ) : props.referenceSummary ? (
                    <p className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                      {props.referenceSummary}
                    </p>
                  ) : null}

                  {compact ? null : (
                    <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                      <div>
                        <span className="font-medium text-slate-700">
                          你先给：
                        </span>
                        {summarizeCuratedTaskRequiredInputs(task)}
                      </div>
                      <div>
                        <span className="font-medium text-slate-700">
                          这一步先拿：
                        </span>
                        {summarizeCuratedTaskOutputContract(task)}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={cn(
                    "mt-auto flex justify-between gap-3",
                    compact ? "items-center pt-3" : "items-end pt-4",
                  )}
                >
                  {compact ? (
                    <div className="text-[11px] leading-5 text-slate-500">
                      {summarizeCuratedTaskRequiredInputs(task)}
                    </div>
                  ) : (
                    <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                      <div>{getCuratedTaskOutputDestination(task)}</div>
                      <div>
                        接着可做：{summarizeCuratedTaskFollowUpActions(task)}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
                    onClick={() => props.onStartTask(task)}
                  >
                    开始这一步
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
          <p className="text-sm leading-6 text-slate-500">{props.emptyState}</p>
        </div>
      )}
    </div>
  );
}
