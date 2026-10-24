import type {
  KnownModelReasoningEffort,
  ModelReasoningEffort,
  ModelReasoningPolicy,
} from "./modelReasoningPolicy";
import { resolveModelReasoningEffortForModelSwitch } from "./modelReasoningPolicy";

export const BASE_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export const OPTIONAL_REASONING_EFFORTS = ["max", "ultra"] as const;
export const DEFAULT_REASONING_EFFORTS: readonly KnownModelReasoningEffort[] = [
  ...BASE_REASONING_EFFORTS,
  "ultra",
  "persistent",
];

export function enabledReasoningEfforts(
  saved: readonly KnownModelReasoningEffort[] | null | undefined,
): readonly KnownModelReasoningEffort[] {
  return saved ?? DEFAULT_REASONING_EFFORTS;
}

export function reasoningPolicyForPreferences(
  policy: ModelReasoningPolicy | null | undefined,
  enabled: readonly KnownModelReasoningEffort[],
): ModelReasoningPolicy | null {
  if (!policy) return null;
  const levels = policy.supported_reasoning_levels.filter(
    ({ value }) =>
      (value !== "max" && value !== "ultra") ||
      enabled.some((effort) => effort === value),
  );
  const efforts = levels.map(({ value }) => value);
  return {
    ...policy,
    supported_reasoning_levels: levels,
    supported_reasoning_efforts: efforts,
    default_reasoning_level:
      policy.default_reasoning_level &&
      efforts.includes(policy.default_reasoning_level)
        ? policy.default_reasoning_level
        : (efforts[Math.floor((efforts.length - 1) / 2)] ?? null),
    can_set_reasoning_effort: efforts.length > 0,
  };
}

export function preferredReasoningEffort(
  policy: ModelReasoningPolicy | null,
  current: ModelReasoningEffort | "",
): ModelReasoningEffort | "" {
  if (!policy?.can_set_reasoning_effort) return "";
  if (policy.supported_reasoning_efforts.includes(current)) return current;
  return (
    policy.default_reasoning_level ??
    resolveModelReasoningEffortForModelSwitch(policy, current) ??
    ""
  );
}
