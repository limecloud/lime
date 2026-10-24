import { describe, expect, it } from "vitest";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import { selectThreadSummary } from "./threadSummaryProjection";
import {
  getThreadSummaryContentShift,
  getThreadSummaryDisplayMode,
} from "./threadSummaryPanelLayout";

describe("Thread Summary projection and layout", () => {
  it("keeps timeline warnings out of summary sections", () => {
    const warning: AgentThreadItem = {
      id: "warning-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed",
      started_at: "2026-10-18T00:00:00Z",
      updated_at: "2026-10-18T00:00:00Z",
      type: "warning",
      message: "Keep in timeline",
    };
    expect(selectThreadSummary([warning])).toEqual({
      plan: null,
      outputs: [],
      hasWebSearch: false,
    });
  });

  it("uses main-pane geometry for shipped overlay/shift/gutter thresholds", () => {
    expect(
      [1095, 1096, 1535, 1536].map((width) =>
        getThreadSummaryDisplayMode(width),
      ),
    ).toEqual(["overlay", "shift", "shift", "gutter"]);
    expect(getThreadSummaryDisplayMode(1135, 340)).toBe("overlay");
    expect(getThreadSummaryDisplayMode(1136, 340)).toBe("shift");
    expect(getThreadSummaryContentShift("shift", true)).toBe(-154);
    expect(getThreadSummaryContentShift("shift", true, 340)).toBe(-174);
    expect(getThreadSummaryContentShift("gutter", true)).toBe(0);
    expect(getThreadSummaryContentShift("overlay", true)).toBe(0);
    expect(getThreadSummaryContentShift("shift", false)).toBe(0);
  });
});
