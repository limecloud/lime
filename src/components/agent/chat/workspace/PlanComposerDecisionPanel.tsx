import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CornerDownLeft,
  Loader2,
  PencilLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionRequired, ConfirmResponse, QuestionOption } from "../types";

interface PlanComposerDecisionPanelProps {
  request: ActionRequired;
  onSubmit?: (response: ConfirmResponse) => void | Promise<void>;
  onDismiss?: (requestId: string) => void;
}

interface SubmissionState {
  kind: "submit" | "ignore";
}

interface PlanRevisionStatus {
  revisionId: string;
  sourceItemId?: string;
  turnId?: string;
  source?: string;
}

const USER_ACTIVATION_WINDOW_MS = 5_000;

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function normalizeQuestionOptions(rawOptions: unknown): QuestionOption[] {
  if (!Array.isArray(rawOptions)) {
    return [];
  }

  const normalized: QuestionOption[] = [];
  const seen = new Set<string>();
  for (const option of rawOptions) {
    const label =
      typeof option === "string"
        ? option
        : option && typeof option === "object"
          ? String(
              (option as Record<string, unknown>).label ??
                (option as Record<string, unknown>).value ??
                (option as Record<string, unknown>).text ??
                "",
            )
          : "";
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    normalized.push({
      label: trimmed,
      description:
        option && typeof option === "object"
          ? typeof (option as Record<string, unknown>).description === "string"
            ? ((option as Record<string, unknown>).description as string)
            : undefined
          : undefined,
    });
  }
  return normalized;
}

function readStringField(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolvePlanRevisionStatus(
  request: ActionRequired,
): PlanRevisionStatus | null {
  const args =
    request.arguments && typeof request.arguments === "object"
      ? request.arguments
      : null;
  const revisionId = readStringField(
    args,
    "plan_revision_id",
    "planRevisionId",
  );
  if (!revisionId) {
    return null;
  }

  return {
    revisionId,
    sourceItemId: readStringField(args, "source_item_id", "sourceItemId"),
    turnId: readStringField(args, "turn_id", "turnId"),
    source: readStringField(args, "plan_source", "source"),
  };
}

function fallbackPlanOptions(t: (key: string) => string): QuestionOption[] {
  return [{ label: t("agentChat.planComposerDecision.option.accept") }];
}

function resolvePrimaryQuestion(
  request: ActionRequired,
  t: (key: string) => string,
): string {
  return (
    request.questions?.[0]?.question?.trim() ||
    request.prompt?.trim() ||
    t("agentChat.planComposerDecision.defaultQuestion")
  );
}

function resolvePrimaryOptions(
  request: ActionRequired,
  t: (key: string) => string,
): QuestionOption[] {
  const firstQuestion = request.questions?.[0];
  const normalized = normalizeQuestionOptions(firstQuestion?.options);
  const options = normalized.length > 0 ? normalized : fallbackPlanOptions(t);
  return options.slice(0, 1);
}

function buildSubmitPayload(params: {
  request: ActionRequired;
  selectedLabel: string;
  adjustment: string;
}): ConfirmResponse {
  const { request, selectedLabel, adjustment } = params;
  const answer = adjustment.trim() || selectedLabel;
  const userData = { answer };
  return {
    requestId: request.requestId,
    confirmed: true,
    response: JSON.stringify(userData),
    actionType: request.actionType,
    userData,
  };
}

export function PlanComposerDecisionPanel({
  request,
  onSubmit,
  onDismiss,
}: PlanComposerDecisionPanelProps) {
  const { t } = useTranslation("agent");
  const translatePlanDecision = useCallback(
    (key: string, values?: Record<string, number | string>): string =>
      String(t(key as never, values ?? {})),
    [t],
  );
  const question = resolvePrimaryQuestion(request, translatePlanDecision);
  const revisionStatus = useMemo(
    () => resolvePlanRevisionStatus(request),
    [request],
  );
  const options = useMemo(
    () => resolvePrimaryOptions(request, translatePlanDecision),
    [request, translatePlanDecision],
  );
  const [selectedLabel, setSelectedLabel] = useState(options[0]?.label ?? "");
  const [adjustment, setAdjustment] = useState("");
  const [submissionState, setSubmissionState] =
    useState<SubmissionState | null>(null);
  const latestUserActivationAtRef = useRef(0);
  const isSubmitting = submissionState !== null;
  const canSubmit =
    selectedLabel.trim().length > 0 || adjustment.trim().length > 0;

  useEffect(() => {
    setSelectedLabel(options[0]?.label ?? "");
    setAdjustment("");
    setSubmissionState(null);
    latestUserActivationAtRef.current = 0;
  }, [options, request.requestId]);

  const rememberUserActivation = () => {
    latestUserActivationAtRef.current = Date.now();
  };

  const isExplicitUserActivation = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.nativeEvent.isTrusted) {
      return true;
    }
    const activatedAt = latestUserActivationAtRef.current;
    return (
      activatedAt > 0 && Date.now() - activatedAt <= USER_ACTIVATION_WINDOW_MS
    );
  };

  const submitResponse = useCallback(
    (response: ConfirmResponse, nextState: SubmissionState) => {
      if (!onSubmit || isSubmitting) {
        return;
      }
      setSubmissionState(nextState);
      try {
        const result = onSubmit(response);
        if (isPromiseLike(result)) {
          void result.finally(() => {
            setSubmissionState((current) =>
              current?.kind === nextState.kind ? null : current,
            );
          });
          return;
        }
        setSubmissionState((current) =>
          current?.kind === nextState.kind ? null : current,
        );
      } catch (error) {
        setSubmissionState((current) =>
          current?.kind === nextState.kind ? null : current,
        );
        throw error;
      }
    },
    [isSubmitting, onSubmit],
  );

  useEffect(() => {
    const approve = () => {
      submitResponse(
        buildSubmitPayload({ request, selectedLabel, adjustment }),
        { kind: "submit" },
      );
    };
    const deny = () => {
      onDismiss?.(request.requestId);
      submitResponse(
        {
          requestId: request.requestId,
          confirmed: false,
          response: translatePlanDecision(
            "agentChat.planComposerDecision.ignoreResponse",
          ),
          actionType: request.actionType,
          userData: "",
        },
        { kind: "ignore" },
      );
    };
    window.addEventListener("lime:approve-pending", approve);
    window.addEventListener("lime:deny-pending", deny);
    return () => {
      window.removeEventListener("lime:approve-pending", approve);
      window.removeEventListener("lime:deny-pending", deny);
    };
  }, [
    adjustment,
    onDismiss,
    request,
    selectedLabel,
    submitResponse,
    translatePlanDecision,
  ]);

  const handleSubmit = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isExplicitUserActivation(event)) {
      return;
    }
    submitResponse(buildSubmitPayload({ request, selectedLabel, adjustment }), {
      kind: "submit",
    });
  };

  const handleIgnore = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isExplicitUserActivation(event)) {
      return;
    }
    onDismiss?.(request.requestId);
    submitResponse(
      {
        requestId: request.requestId,
        confirmed: false,
        response: translatePlanDecision(
          "agentChat.planComposerDecision.ignoreResponse",
        ),
        actionType: request.actionType,
        userData: "",
      },
      { kind: "ignore" },
    );
  };

  return (
    <section
      className="w-full max-w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-950/5"
      data-testid="plan-composer-decision-panel"
      data-layout="composer-drawer"
      data-request-id={request.requestId}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          rememberUserActivation();
        }
      }}
      onPointerDownCapture={rememberUserActivation}
    >
      <div className="px-1 pb-2 text-sm font-semibold leading-5 text-slate-950">
        {question}
      </div>
      {revisionStatus ? (
        <div
          className="mb-2 flex min-w-0 items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800"
          data-testid="plan-composer-revision-status"
          data-plan-revision-id={revisionStatus.revisionId}
          data-plan-source-item-id={revisionStatus.sourceItemId}
          data-plan-turn-id={revisionStatus.turnId}
          data-plan-source={revisionStatus.source}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {translatePlanDecision(
              "agentChat.planComposerDecision.revision.bound",
              { revision: revisionStatus.revisionId },
            )}
          </span>
        </div>
      ) : null}
      <div className="space-y-1">
        {options.map((option, index) => {
          const selected = option.label === selectedLabel;
          return (
            <button
              key={option.label}
              type="button"
              disabled={isSubmitting}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm transition",
                selected
                  ? "bg-slate-100 text-slate-950"
                  : "bg-white text-slate-500 hover:bg-slate-50",
                isSubmitting && "cursor-not-allowed opacity-70",
              )}
              onClick={() => setSelectedLabel(option.label)}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  selected
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-500 ring-1 ring-slate-200",
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="sr-only">{option.description}</span>
                ) : null}
              </span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-slate-300">
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex min-h-10 flex-wrap items-center gap-2 rounded-xl px-2 py-1">
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <PencilLine className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            data-testid="plan-composer-adjust-input"
            value={adjustment}
            disabled={isSubmitting}
            placeholder={translatePlanDecision(
              "agentChat.planComposerDecision.option.adjust",
            )}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
            onChange={(event) => setAdjustment(event.target.value)}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="plan-composer-decision-ignore"
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleIgnore}
          >
            <span>
              {submissionState?.kind === "ignore"
                ? translatePlanDecision(
                    "agentChat.planComposerDecision.ignoring",
                  )
                : translatePlanDecision(
                    "agentChat.planComposerDecision.ignore",
                  )}
            </span>
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-500">
              {translatePlanDecision(
                "agentChat.planComposerDecision.escapeShortcut",
              )}
            </kbd>
          </button>
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-sky-500 px-3 text-sm font-medium text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSubmit}
          >
            {submissionState?.kind === "submit" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            <span>
              {submissionState?.kind === "submit"
                ? translatePlanDecision(
                    "agentChat.planComposerDecision.submitting",
                  )
                : translatePlanDecision(
                    "agentChat.planComposerDecision.submit",
                  )}
            </span>
            {submissionState?.kind === "submit" ? null : (
              <CornerDownLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
