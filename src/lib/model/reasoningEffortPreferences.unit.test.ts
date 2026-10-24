import { describe, expect, it } from "vitest";
import { buildModelReasoningPolicy } from "./modelReasoningPolicy";
import {
  enabledReasoningEfforts,
  preferredReasoningEffort,
  reasoningPolicyForPreferences,
} from "./reasoningEffortPreferences";

const policy = (levels: string[], defaultLevel = "medium") =>
  buildModelReasoningPolicy({
    supported_reasoning_levels: levels,
    default_reasoning_level: defaultLevel,
  });

describe("reasoning effort preferences", () => {
  it("uses reference defaults only for an unconfigured value", () => {
    expect(enabledReasoningEfforts(undefined)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultra",
      "persistent",
    ]);
    expect(enabledReasoningEfforts([])).toEqual([]);
  });
  it("filters optional levels without mutating capability or hiding provider-specific levels", () => {
    const source = policy([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "persistent",
      "adaptive",
    ]);
    const next = reasoningPolicyForPreferences(source, [])!;
    expect(next.supported_reasoning_efforts).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "persistent",
      "adaptive",
    ]);
    expect(source.supported_reasoning_efforts).toContain("max");
    expect(
      reasoningPolicyForPreferences(source, ["max"])!
        .supported_reasoning_efforts,
    ).toContain("max");
  });
  it("returns the model default after disabling the selected optional level", () => {
    const next = reasoningPolicyForPreferences(
      policy(["low", "medium", "high", "max", "ultra"]),
      [],
    )!;
    expect(preferredReasoningEffort(next, "ultra")).toBe("medium");
    expect(preferredReasoningEffort(next, "high")).toBe("high");
  });
  it("never returns a disabled default or fabricates an effort", () => {
    const next = reasoningPolicyForPreferences(
      policy(["low", "high", "max"], "max"),
      [],
    )!;
    expect(preferredReasoningEffort(next, "max")).toBe("low");
    const empty = reasoningPolicyForPreferences(policy(["max"], "max"), [])!;
    expect(empty.can_set_reasoning_effort).toBe(false);
    expect(preferredReasoningEffort(empty, "max")).toBe("");
    expect(reasoningPolicyForPreferences(undefined, [])).toBeNull();
  });
});
