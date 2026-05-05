import { describe, expect, it } from "vitest";
import { createLayeredDesignSeedDocument } from "./planner";

const CREATED_AT = "2026-05-05T00:00:00.000Z";

describe("createLayeredDesignSeedDocument", () => {
  it("应从 prompt 创建可编辑图层 seed，而不是单张扁平图", () => {
    const document = createLayeredDesignSeedDocument({
      prompt: "@海报 赛博猫咖开业海报，霓虹灯，首杯半价",
      id: "cyber-cat-cafe",
      title: "赛博猫咖开业海报",
      createdAt: CREATED_AT,
    });

    expect(document.id).toBe("cyber-cat-cafe");
    expect(document.title).toBe("赛博猫咖开业海报");
    expect(document.layers.length).toBeGreaterThanOrEqual(5);
    expect(document.layers.map((layer) => layer.id)).toEqual([
      "background-image",
      "subject-image",
      "atmosphere-effect",
      "headline-text",
      "subtitle-text",
      "cta-shape",
      "cta-text",
    ]);
  });

  it("普通文案应保持 TextLayer，避免把文字烘焙进图片", () => {
    const document = createLayeredDesignSeedDocument({
      prompt: "@配图 春季新品主视觉",
      createdAt: CREATED_AT,
    });

    const textLayers = document.layers.filter((layer) => layer.type === "text");
    const imageLayers = document.layers.filter(
      (layer) => layer.type === "image" || layer.type === "effect",
    );

    expect(textLayers.map((layer) => layer.name)).toEqual([
      "主标题",
      "副标题",
      "CTA 文案",
    ]);
    expect(textLayers.map((layer) => layer.source)).toEqual([
      "planned",
      "planned",
      "planned",
    ]);
    expect(imageLayers).toHaveLength(3);
  });

  it("图片资产应只是 plannedOnly 占位，不调用 provider 或模型", () => {
    const document = createLayeredDesignSeedDocument({
      prompt: "Minimal coffee poster",
      createdAt: CREATED_AT,
    });

    expect(document.assets).toHaveLength(3);
    expect(
      document.assets.every(
        (asset) =>
          asset.src === "" &&
          asset.params?.plannedOnly === true &&
          asset.provider === undefined &&
          asset.modelId === undefined,
      ),
    ).toBe(true);
  });

  it("应为英文 prompt 生成稳定 id，并保持 zIndex 排序", () => {
    const document = createLayeredDesignSeedDocument({
      prompt: "@poster Spring Launch Hero Poster",
      createdAt: CREATED_AT,
    });

    expect(document.id).toBe("spring-launch-hero-poster");
    expect(document.layers.map((layer) => layer.zIndex)).toEqual([
      0, 20, 30, 40, 45, 50, 55,
    ]);
    expect(document.editHistory.at(-1)).toMatchObject({
      type: "created",
      actor: "assistant",
      createdAt: CREATED_AT,
    });
  });
});
