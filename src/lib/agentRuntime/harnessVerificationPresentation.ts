import type {
  AgentRuntimeArtifactValidatorVerificationSummary,
  AgentRuntimeBrowserVerificationSummary,
  AgentRuntimeEvidenceVerificationOutcome,
  AgentRuntimeEvidenceVerificationSummary,
  AgentRuntimeGuiSmokeVerificationSummary,
} from "@/lib/api/agentRuntime";

export type HarnessVerificationBadgeVariant =
  | "secondary"
  | "destructive"
  | "outline";

export interface HarnessVerificationOutcomeBadgePresentation {
  label: string;
  variant: HarnessVerificationBadgeVariant;
}

export interface HarnessEvidenceVerificationCardPresentation {
  key: "artifact_validator" | "browser_verification" | "gui_smoke";
  title: string;
  badge: HarnessVerificationOutcomeBadgePresentation;
  description: string;
}

export function resolveHarnessVerificationOutcomeBadgePresentation(
  outcome?: AgentRuntimeEvidenceVerificationOutcome,
): HarnessVerificationOutcomeBadgePresentation {
  switch (outcome) {
    case "success":
      return { label: "通过", variant: "secondary" };
    case "blocking_failure":
      return { label: "阻塞失败", variant: "destructive" };
    case "advisory_failure":
      return { label: "提示失败", variant: "outline" };
    case "recovered":
      return { label: "已恢复", variant: "outline" };
    default:
      return { label: "未定", variant: "outline" };
  }
}

export function describeHarnessArtifactValidatorVerification(
  summary?: AgentRuntimeArtifactValidatorVerificationSummary,
): string {
  if (!summary?.applicable) {
    return "当前没有适用的 Artifact 校验。";
  }

  return `记录 ${summary.record_count} · issues ${summary.issue_count} · repaired ${summary.repaired_count} · fallback ${summary.fallback_used_count}`;
}

export function describeHarnessBrowserVerification(
  summary?: AgentRuntimeBrowserVerificationSummary,
): string {
  if (!summary) {
    return "当前线程没有浏览器验证线索。";
  }

  return `记录 ${summary.record_count} · 成功 ${summary.success_count} · 失败 ${summary.failure_count} · 未判定 ${summary.unknown_count}`;
}

export function describeHarnessGuiSmokeVerification(
  summary?: AgentRuntimeGuiSmokeVerificationSummary,
): string {
  if (!summary) {
    return "当前线程没有 GUI smoke 结果。";
  }

  const status = summary.status?.trim() || "未知";
  const exitCode =
    typeof summary.exit_code === "number" ? summary.exit_code : "未知";

  return `状态 ${status} · exit ${exitCode} · ${
    summary.passed ? "已通过" : "未通过"
  }`;
}

export function buildHarnessEvidenceVerificationCardPresentations(
  summary?: AgentRuntimeEvidenceVerificationSummary,
): HarnessEvidenceVerificationCardPresentation[] {
  if (!summary) {
    return [];
  }

  const cards: HarnessEvidenceVerificationCardPresentation[] = [];

  if (summary.artifact_validator) {
    cards.push({
      key: "artifact_validator",
      title: "Artifact 校验",
      badge: resolveHarnessVerificationOutcomeBadgePresentation(
        summary.artifact_validator.outcome,
      ),
      description: describeHarnessArtifactValidatorVerification(
        summary.artifact_validator,
      ),
    });
  }

  if (summary.browser_verification) {
    cards.push({
      key: "browser_verification",
      title: "浏览器验证",
      badge: resolveHarnessVerificationOutcomeBadgePresentation(
        summary.browser_verification.outcome,
      ),
      description: describeHarnessBrowserVerification(
        summary.browser_verification,
      ),
    });
  }

  if (summary.gui_smoke) {
    cards.push({
      key: "gui_smoke",
      title: "GUI Smoke",
      badge: resolveHarnessVerificationOutcomeBadgePresentation(
        summary.gui_smoke.outcome,
      ),
      description: describeHarnessGuiSmokeVerification(summary.gui_smoke),
    });
  }

  return cards;
}
