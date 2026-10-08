import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isExpandedReasoningSnapshotReady } from "./reasoning-fixture.mjs";
import { buildReasoningFirstVisibleScenarioAssertions } from "./claw-chat-current-fixture-runtime-surface-assertions.mjs";

const expanded = {
  hasReasoningText: true,
  reasoningSummaryOccurrences: 1,
  reasoningProcessOpen: true,
  hasReasoningContentText: false,
  rawReasoningInDom: false,
};

describe("Electron reasoning fixture display policy", () => {
  it("accepts one expanded summary while the raw content stays absent", () => {
    expect(isExpandedReasoningSnapshotReady(expanded)).toBe(true);
  });

  it("rejects visible or hidden DOM leakage of raw reasoning", () => {
    for (const leak of [
      { hasReasoningContentText: true },
      { rawReasoningInDom: true },
    ]) {
      expect(isExpandedReasoningSnapshotReady({ ...expanded, ...leak })).toBe(
        false,
      );
    }
  });

  it("rejects repeated, missing, closed or incomplete observations", () => {
    for (const invalid of [
      { reasoningSummaryOccurrences: 2 },
      { reasoningSummaryOccurrences: 0 },
      { hasReasoningText: false },
      { reasoningProcessOpen: false },
      { rawReasoningInDom: undefined },
    ]) {
      expect(
        isExpandedReasoningSnapshotReady({ ...expanded, ...invalid }),
      ).toBe(false);
    }
    expect(isExpandedReasoningSnapshotReady(null)).toBe(false);
  });

  it("requires canonical content even though the GUI hides it", () => {
    const readModel = {
      includesPrompt: true,
      latestTurnStatus: "completed",
      includesFinalText: true,
      includesReasoningText: true,
      includesReasoningContentText: true,
    };
    const assertions = (content) =>
      buildReasoningFirstVisibleScenarioAssertions({
        summary: {
          readModelReasoningFirstVisibleCompleted: {
            ...readModel,
            includesReasoningContentText: content,
          },
        },
      }).readModelReasoningFirstVisibleCompleted;
    expect(assertions(true)).toBe(true);
    expect(assertions(false)).toBe(false);
  });

  it("keeps reasoning observations out of the generic waits and scenario router", () => {
    const source = (file) =>
      readFileSync(`scripts/agent-runtime/${file}`, "utf8");
    expect(
      source("claw-chat-current-fixture-gui-completion-waits.mjs"),
    ).not.toContain("function reasoningFirstVisibleSnapshotFromDom");
    expect(source("claw-chat-current-fixture-scenario-flow.mjs")).not.toContain(
      "function summarizeReasoningFirstVisibleReadModel",
    );
    for (const file of [
      "claw-chat-current-fixture-gui-completion-waits.mjs",
      "claw-chat-current-fixture-scenario-flow.mjs",
    ])
      expect(source(file).split("\n").length).toBeLessThan(1000);
    expect(source("reasoning-fixture.mjs").split("\n").length).toBeLessThan(
      800,
    );
    expect(source("reasoning-fixture.mjs")).not.toContain(
      "reasoningContentExpandedAfterCompletion",
    );
  });
});
