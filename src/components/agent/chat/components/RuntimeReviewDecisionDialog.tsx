import { useEffect, useState } from "react";
import type {
  AgentRuntimeReviewDecisionRiskLevel,
  AgentRuntimeReviewDecisionStatus,
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeSaveReviewDecisionRequest,
} from "@/lib/api/agentRuntime";
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
import { Textarea } from "@/components/ui/textarea";
import { HarnessVerificationSummarySection } from "./HarnessVerificationSummarySection";

interface RuntimeReviewDecisionDialogProps {
  open: boolean;
  template: AgentRuntimeReviewDecisionTemplate | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (request: AgentRuntimeSaveReviewDecisionRequest) => Promise<void>;
}

interface ReviewDecisionFormState {
  decision_status: AgentRuntimeReviewDecisionStatus;
  decision_summary: string;
  chosen_fix_strategy: string;
  risk_level: AgentRuntimeReviewDecisionRiskLevel;
  risk_tags_text: string;
  human_reviewer: string;
  reviewed_at?: string;
  followup_actions_text: string;
  regression_requirements_text: string;
  notes: string;
}

const DEFAULT_STATUS_OPTIONS: AgentRuntimeReviewDecisionStatus[] = [
  "accepted",
  "deferred",
  "rejected",
  "needs_more_evidence",
  "pending_review",
];

const DEFAULT_RISK_LEVEL_OPTIONS: AgentRuntimeReviewDecisionRiskLevel[] = [
  "low",
  "medium",
  "high",
  "unknown",
];

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

function formatStatusLabel(status: AgentRuntimeReviewDecisionStatus): string {
  switch (status) {
    case "accepted":
      return "接受";
    case "deferred":
      return "延后";
    case "rejected":
      return "拒绝";
    case "needs_more_evidence":
      return "需要更多证据";
    case "pending_review":
      return "待人工审核";
    default:
      return status;
  }
}

function formatRiskLevelLabel(
  riskLevel: AgentRuntimeReviewDecisionRiskLevel,
): string {
  switch (riskLevel) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "unknown":
      return "未定";
    default:
      return riskLevel;
  }
}

function createFormState(
  template: AgentRuntimeReviewDecisionTemplate,
): ReviewDecisionFormState {
  return {
    decision_status: template.decision.decision_status,
    decision_summary: template.decision.decision_summary,
    chosen_fix_strategy: template.decision.chosen_fix_strategy,
    risk_level: template.decision.risk_level,
    risk_tags_text: template.decision.risk_tags.join(", "),
    human_reviewer: template.decision.human_reviewer,
    reviewed_at: template.decision.reviewed_at,
    followup_actions_text: template.decision.followup_actions.join("\n"),
    regression_requirements_text:
      template.decision.regression_requirements.join("\n"),
    notes: template.decision.notes,
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RuntimeReviewDecisionDialog({
  open,
  template,
  saving,
  onOpenChange,
  onSave,
}: RuntimeReviewDecisionDialogProps) {
  const [formState, setFormState] = useState<ReviewDecisionFormState | null>(
    template ? createFormState(template) : null,
  );

  useEffect(() => {
    if (!template) {
      setFormState(null);
      return;
    }

    if (open) {
      setFormState(createFormState(template));
    }
  }, [open, template]);

  const statusOptions = template?.decision_status_options.length
    ? template.decision_status_options
    : DEFAULT_STATUS_OPTIONS;
  const riskLevelOptions = template?.risk_level_options.length
    ? template.risk_level_options
    : DEFAULT_RISK_LEVEL_OPTIONS;

  const handleSave = async () => {
    if (!template || !formState) {
      return;
    }

    await onSave({
      session_id: template.session_id,
      decision_status: formState.decision_status,
      decision_summary: formState.decision_summary,
      chosen_fix_strategy: formState.chosen_fix_strategy,
      risk_level: formState.risk_level,
      risk_tags: splitCommaSeparated(formState.risk_tags_text),
      human_reviewer: formState.human_reviewer,
      reviewed_at: formState.reviewed_at,
      followup_actions: splitLines(formState.followup_actions_text),
      regression_requirements: splitLines(
        formState.regression_requirements_text,
      ),
      notes: formState.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="max-w-3xl" className="p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>填写人工审核结果</DialogTitle>
          <DialogDescription className="space-y-1 text-xs leading-5">
            <span className="block">
              当前会话会把最终审核结果写回
              `review-decision.md/json`，继续沿用现有 analysis / handoff /
              evidence / replay 主链。
            </span>
            {template ? (
              <span className="block font-mono text-[11px] text-muted-foreground">
                {template.review_relative_root}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {template && formState ? (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
            {template.verification_summary ? (
              <HarnessVerificationSummarySection
                summary={template.verification_summary}
              />
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="review-decision-status"
                  className="text-xs font-medium text-foreground"
                >
                  决策状态
                </label>
                <select
                  id="review-decision-status"
                  aria-label="决策状态"
                  className={selectClassName}
                  value={formState.decision_status}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            decision_status: event.target
                              .value as AgentRuntimeReviewDecisionStatus,
                          }
                        : current,
                    )
                  }
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="review-risk-level"
                  className="text-xs font-medium text-foreground"
                >
                  风险等级
                </label>
                <select
                  id="review-risk-level"
                  aria-label="风险等级"
                  className={selectClassName}
                  value={formState.risk_level}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            risk_level: event.target
                              .value as AgentRuntimeReviewDecisionRiskLevel,
                          }
                        : current,
                    )
                  }
                >
                  {riskLevelOptions.map((riskLevel) => (
                    <option key={riskLevel} value={riskLevel}>
                      {formatRiskLevelLabel(riskLevel)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="review-human-reviewer"
                  className="text-xs font-medium text-foreground"
                >
                  审核人
                </label>
                <Input
                  id="review-human-reviewer"
                  aria-label="审核人"
                  value={formState.human_reviewer}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            human_reviewer: event.target.value,
                          }
                        : current,
                    )
                  }
                  placeholder="例如：Lime Maintainer"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="review-risk-tags"
                  className="text-xs font-medium text-foreground"
                >
                  风险标签
                </label>
                <Input
                  id="review-risk-tags"
                  aria-label="风险标签"
                  value={formState.risk_tags_text}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            risk_tags_text: event.target.value,
                          }
                        : current,
                    )
                  }
                  placeholder="用英文逗号分隔，例如：runtime, ui"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="review-decision-summary"
                className="text-xs font-medium text-foreground"
              >
                决策摘要
              </label>
              <Textarea
                id="review-decision-summary"
                aria-label="决策摘要"
                value={formState.decision_summary}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          decision_summary: event.target.value,
                        }
                      : current,
                  )
                }
                rows={4}
                placeholder="说明为什么接受、延后、拒绝，或为什么还需要更多证据。"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="review-fix-strategy"
                className="text-xs font-medium text-foreground"
              >
                采用的修复策略
              </label>
              <Textarea
                id="review-fix-strategy"
                aria-label="采用的修复策略"
                value={formState.chosen_fix_strategy}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          chosen_fix_strategy: event.target.value,
                        }
                      : current,
                  )
                }
                rows={4}
                placeholder="记录最终采用的最小修复方案，以及为什么不继续扩散范围。"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="review-regressions"
                  className="text-xs font-medium text-foreground"
                >
                  回归要求
                </label>
                <Textarea
                  id="review-regressions"
                  aria-label="回归要求"
                  value={formState.regression_requirements_text}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            regression_requirements_text: event.target.value,
                          }
                        : current,
                    )
                  }
                  rows={5}
                  placeholder="每行一条，例如：npm run test:contracts"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="review-followups"
                  className="text-xs font-medium text-foreground"
                >
                  后续动作
                </label>
                <Textarea
                  id="review-followups"
                  aria-label="后续动作"
                  value={formState.followup_actions_text}
                  onChange={(event) =>
                    setFormState((current) =>
                      current
                        ? {
                            ...current,
                            followup_actions_text: event.target.value,
                          }
                        : current,
                    )
                  }
                  rows={5}
                  placeholder="每行一条，例如：补充 HarnessStatusPanel 回归"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="review-notes"
                className="text-xs font-medium text-foreground"
              >
                审核备注
              </label>
              <Textarea
                id="review-notes"
                aria-label="审核备注"
                value={formState.notes}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          notes: event.target.value,
                        }
                      : current,
                  )
                }
                rows={4}
                placeholder="补充未决风险、边界判断或暂不处理的原因。"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!template || !formState || saving}
          >
            {saving ? "保存中..." : "保存审核结果"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
