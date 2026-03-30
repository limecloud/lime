import { describe, expect, it } from "vitest";
import { buildLayerMetrics } from "./memoryLayerMetrics";

describe("buildLayerMetrics", () => {
  it("仅第一层有数据时应返回 1/3 可用", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 3,
      contextTotalEntries: 0,
      projectId: null,
      projectMemory: null,
    });

    const unifiedCard = result.cards.find((card) => card.key === "unified");
    const contextCard = result.cards.find((card) => card.key === "context");
    const projectCard = result.cards.find((card) => card.key === "project");

    expect(unifiedCard?.available).toBe(true);
    expect(contextCard?.available).toBe(false);
    expect(projectCard?.available).toBe(false);
    expect(result.readyLayers).toBe(1);
  });

  it("仅第二层有数据时应返回 1/3 可用", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 0,
      contextTotalEntries: 6,
      projectId: null,
      projectMemory: null,
    });

    const unifiedCard = result.cards.find((card) => card.key === "unified");
    const contextCard = result.cards.find((card) => card.key === "context");
    const projectCard = result.cards.find((card) => card.key === "project");

    expect(unifiedCard?.available).toBe(false);
    expect(contextCard?.available).toBe(true);
    expect(projectCard?.available).toBe(false);
    expect(result.readyLayers).toBe(1);
  });

  it("三层都有数据时应返回 3/3 可用", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 12,
      contextTotalEntries: 5,
      projectId: "project-1",
      projectMemory: {
        characters: [
          {
            id: "c1",
            project_id: "project-1",
            name: "主角",
            aliases: [],
            relationships: [],
            is_main: true,
            order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        world_building: {
          project_id: "project-1",
          description: "未来都市",
          updated_at: "2026-01-01T00:00:00Z",
        },
        outline: [
          {
            id: "o1",
            project_id: "project-1",
            title: "第一章",
            order: 0,
            expanded: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    });

    expect(result.totalLayers).toBe(3);
    expect(result.readyLayers).toBe(3);
    expect(result.cards[2]?.value).toBe(3);
    expect(result.cards[2]?.available).toBe(true);
  });

  it("第三层部分维度已完善时也应判定为可用", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 0,
      contextTotalEntries: 0,
      projectId: "project-1",
      projectMemory: {
        characters: [
          {
            id: "c1",
            project_id: "project-1",
            name: "主角",
            aliases: [],
            relationships: [],
            is_main: true,
            order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        outline: [],
      },
    });

    const projectCard = result.cards.find((card) => card.key === "project");
    expect(projectCard?.available).toBe(true);
    expect(projectCard?.value).toBe(1);
    expect(result.readyLayers).toBe(1);
  });

  it("未选择项目时第三层应不可用并给出说明", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 4,
      contextTotalEntries: 2,
      projectId: null,
      projectMemory: null,
    });

    const projectCard = result.cards.find((card) => card.key === "project");
    expect(projectCard?.available).toBe(false);
    expect(projectCard?.description).toContain("未选择项目");
    expect(result.readyLayers).toBe(2);
  });

  it("已选项目但无项目记忆内容时第三层仍不可用", () => {
    const result = buildLayerMetrics({
      unifiedTotalEntries: 0,
      contextTotalEntries: 1,
      projectId: "project-2",
      projectMemory: {
        characters: [],
        outline: [],
      },
    });

    const projectCard = result.cards.find((card) => card.key === "project");
    expect(projectCard?.value).toBe(0);
    expect(projectCard?.available).toBe(false);
    expect(projectCard?.description).toContain("还未填写");
    expect(result.readyLayers).toBe(1);
  });
});
