import type { AgentRuntimeEvidenceVerificationSummary } from "@/lib/api/agentRuntime";
import { buildHarnessEvidenceVerificationCardPresentations } from "@/lib/agentRuntime/harnessVerificationPresentation";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";

export function HarnessVerificationSummarySection({
  summary,
}: {
  summary: AgentRuntimeEvidenceVerificationSummary;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldAlert className="h-4 w-4 text-emerald-600" />
        <span>验证结果</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {buildHarnessEvidenceVerificationCardPresentations(summary).map(
          (card) => (
            <div
              key={card.key}
              className="rounded-lg border border-border/70 bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {card.title}
                </span>
                <Badge variant={card.badge.variant}>{card.badge.label}</Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {card.description}
              </div>
            </div>
          ),
        )}
      </div>

      {summary.focus_verification_failure_outcomes.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <div className="text-sm font-medium text-amber-900">验证失败焦点</div>
          <div className="mt-2 space-y-1 text-xs text-amber-800">
            {summary.focus_verification_failure_outcomes.map((outcome, index) => (
              <div key={`${outcome}-${index}`}>{outcome}</div>
            ))}
          </div>
        </div>
      ) : null}

      {summary.focus_verification_recovered_outcomes.length > 0 ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
          <div className="text-sm font-medium text-emerald-900">已恢复结果</div>
          <div className="mt-2 space-y-1 text-xs text-emerald-800">
            {summary.focus_verification_recovered_outcomes.map(
              (outcome, index) => (
                <div key={`${outcome}-${index}`}>{outcome}</div>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
