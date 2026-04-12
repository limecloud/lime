import { describe, expect, it } from "vitest";
import { buildLayerMetrics } from "./memoryLayerMetrics";

describe("buildLayerMetrics", () => {
  it("仅规则层有数据时应返回 1/5 可用", () => {
    const result = buildLayerMetrics({
      rulesSourceCount: 3,
      workingEntryCount: 0,
      durableEntryCount: 0,
      teamSnapshotCount: 0,
      compactionCount: 0,
    });

    expect(result.cards.find((card) => card.key === "rules")?.available).toBe(true);
    expect(result.cards.find((card) => card.key === "working")?.available).toBe(false);
    expect(result.cards.find((card) => card.key === "durable")?.available).toBe(false);
    expect(result.readyLayers).toBe(1);
    expect(result.totalLayers).toBe(5);
  });

  it("仅工作记忆层有数据时应返回 1/5 可用", () => {
    const result = buildLayerMetrics({
      rulesSourceCount: 0,
      workingEntryCount: 6,
      durableEntryCount: 0,
      teamSnapshotCount: 0,
      compactionCount: 0,
    });

    expect(result.cards.find((card) => card.key === "rules")?.available).toBe(false);
    expect(result.cards.find((card) => card.key === "working")?.available).toBe(true);
    expect(result.cards.find((card) => card.key === "team")?.available).toBe(false);
    expect(result.readyLayers).toBe(1);
  });

  it("五层都有数据时应返回 5/5 可用", () => {
    const result = buildLayerMetrics({
      rulesSourceCount: 4,
      workingEntryCount: 12,
      durableEntryCount: 9,
      teamSnapshotCount: 2,
      compactionCount: 3,
    });

    expect(result.readyLayers).toBe(5);
    expect(result.totalLayers).toBe(5);
    expect(result.cards.find((card) => card.key === "compaction")?.value).toBe(3);
    expect(result.cards.find((card) => card.key === "team")?.available).toBe(true);
  });

  it("仅 Team 影子层有数据时也应判定为可用", () => {
    const result = buildLayerMetrics({
      rulesSourceCount: 0,
      workingEntryCount: 0,
      durableEntryCount: 0,
      teamSnapshotCount: 1,
      compactionCount: 0,
    });

    expect(result.cards.find((card) => card.key === "team")?.available).toBe(true);
    expect(result.cards.find((card) => card.key === "team")?.value).toBe(1);
    expect(result.readyLayers).toBe(1);
  });

  it("压缩边界缺失时应给出待完善说明", () => {
    const result = buildLayerMetrics({
      rulesSourceCount: 4,
      workingEntryCount: 2,
      durableEntryCount: 1,
      teamSnapshotCount: 0,
      compactionCount: 0,
    });

    const compactionCard = result.cards.find((card) => card.key === "compaction");
    expect(compactionCard?.value).toBe(0);
    expect(compactionCard?.available).toBe(false);
    expect(compactionCard?.description).toContain("还没有可复用的上下文压缩摘要");
    expect(result.readyLayers).toBe(3);
  });
});
