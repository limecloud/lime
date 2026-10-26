import { describe, expect, it } from "vitest";
import type { AgentThreadItem } from "../types";
import { buildAgentThreadDisplayModel } from "./agentThreadGrouping";

describe("canonical MCP timeline", () => {
  it("相邻 MCP 调用保持独立且按同一 Turn 的序号排列", () => {
    const tool = (
      sequence: number,
      canonicalType: string,
    ): AgentThreadItem => ({
      id: `tool-${sequence}`,
      thread_id: "thread-1",
      turn_id: "turn-1",
      type: "tool_call",
      tool_name: "diagnostic_probe",
      status: "completed",
      sequence,
      started_at: "2026-10-26T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
      metadata: { canonical_type: canonicalType, server: "docs" },
    });
    const model = buildAgentThreadDisplayModel([
      tool(3, "dynamicToolCall"),
      tool(2, "mcpToolCall"),
      tool(1, "mcpToolCall"),
    ]);
    expect(
      model.orderedBlocks.map((block) => block.items.map(({ id }) => id)),
    ).toEqual([["tool-1"], ["tool-2"], ["tool-3"]]);
  });
});
