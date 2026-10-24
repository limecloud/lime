import type {
  Config,
  ToolExecutionCommandRuleConfig,
  ToolExecutionNetworkRuleConfig,
} from "@/lib/api/appConfig";

export type RuleKind = "shell" | "network";
export type WarningPolicy = "none" | "shell_command_risk";

export interface ExecutionPolicyDraft {
  updatePlanEnabled: boolean;
  bashWarningPolicy: WarningPolicy;
  shellRules: ToolExecutionCommandRuleConfig[];
  networkRules: ToolExecutionNetworkRuleConfig[];
}
export type ExecutionPolicyField = keyof ExecutionPolicyDraft;

export function normalizeShellRule(
  rule: ToolExecutionCommandRuleConfig,
): ToolExecutionCommandRuleConfig {
  return {
    ...rule,
    rule_id: rule.rule_id || "",
    match_type: rule.match_type ?? "regex",
    pattern: rule.pattern || "",
    risk_level: rule.risk_level ?? "medium",
    reason_code: rule.reason_code || "",
    reason: rule.reason || "",
  };
}

export function normalizeNetworkRule(
  rule: ToolExecutionNetworkRuleConfig,
): ToolExecutionNetworkRuleConfig {
  return { ...normalizeShellRule(rule), target: rule.target ?? "url" };
}

export function createShellRule(): ToolExecutionCommandRuleConfig {
  return normalizeShellRule({
    rule_id: "",
    pattern: "",
    match_type: "prefix",
    risk_level: "high",
  });
}

export function createNetworkRule(): ToolExecutionNetworkRuleConfig {
  return { ...createShellRule(), target: "host" };
}

export function readExecutionPolicyDraft(
  config?: Config,
): ExecutionPolicyDraft {
  const policy = config?.agent?.tool_execution;
  return {
    updatePlanEnabled: policy?.update_plan_enabled ?? false,
    bashWarningPolicy:
      policy?.tool_overrides?.bash?.warning_policy ??
      policy?.tool_overrides?.Bash?.warning_policy ??
      "shell_command_risk",
    shellRules: (policy?.shell_command_rules ?? []).map(normalizeShellRule),
    networkRules: (policy?.network_rules ?? []).map(normalizeNetworkRule),
  };
}

export function countToolOverrides(config: Config) {
  return new Set(
    Object.keys(config.agent?.tool_execution?.tool_overrides ?? {}).map((key) =>
      key.toLowerCase(),
    ),
  ).size;
}

export function mergeExecutionPolicyDraft(
  current: Config,
  draft: ExecutionPolicyDraft,
  snapshot: ExecutionPolicyDraft,
): Config {
  const changed = (field: ExecutionPolicyField) =>
    JSON.stringify(draft[field]) !== JSON.stringify(snapshot[field]);
  const agent = { ...current.agent };
  if (
    [
      "updatePlanEnabled",
      "bashWarningPolicy",
      "shellRules",
      "networkRules",
    ].some((field) => changed(field as ExecutionPolicyField))
  ) {
    const policy = { ...agent.tool_execution };
    if (changed("updatePlanEnabled"))
      policy.update_plan_enabled = draft.updatePlanEnabled;
    if (changed("shellRules"))
      policy.shell_command_rules = draft.shellRules.map(normalizeShellRule);
    if (changed("networkRules"))
      policy.network_rules = draft.networkRules.map(normalizeNetworkRule);
    if (changed("bashWarningPolicy")) {
      const overrides = { ...policy.tool_overrides };
      const bash = overrides.bash ?? overrides.Bash;
      delete overrides.Bash;
      overrides.bash = {
        ...bash,
        warning_policy: draft.bashWarningPolicy,
        restriction_profile: "workspace_shell_command",
        sandbox_profile: "workspace_command",
      };
      policy.tool_overrides = overrides;
    }
    agent.tool_execution = policy;
  }
  return { ...current, agent };
}
