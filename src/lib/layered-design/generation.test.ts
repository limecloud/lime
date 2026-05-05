import { describe, expect, it } from "vitest";
import type { GeneratedDesignAsset, ImageLayer } from "./types";
import {
  applyLayeredDesignGeneratedAsset,
  createLayeredDesignAssetGenerationPlan,
  createSingleLayerAssetGenerationRequest,
} from "./generation";
import { createLayeredDesignSeedDocument } from "./planner";

const CREATED_AT = "2026-05-05T00:00:00.000Z";
const UPDATED_AT = "2026-05-05T01:00:00.000Z";

function createSeedDocument() {
  return createLayeredDesignSeedDocument({
    prompt: "@海报 复古唱片店开业活动",
    id: "record-store-opening",
    title: "复古唱片店开业活动",
    createdAt: CREATED_AT,
  });
}

function createGeneratedAsset(
  id: string,
  overrides: Partial<GeneratedDesignAsset> = {},
): GeneratedDesignAsset {
  return {
    id,
    kind: "background",
    src: `/generated/${id}.png`,
    width: 1080,
    height: 1440,
    hasAlpha: false,
    provider: "openai",
    modelId: "gpt-image-2",
    prompt: "生成背景层",
    createdAt: UPDATED_AT,
    ...overrides,
  };
}

describe("layered-design generation seam", () => {
  it("应从图层文档创建图片资产生成计划，并跳过 TextLayer", () => {
    const document = createSeedDocument();

    const plan = createLayeredDesignAssetGenerationPlan(document);

    expect(plan.map((request) => request.layerId)).toEqual([
      "background-image",
      "subject-image",
      "atmosphere-effect",
    ]);
    expect(plan.map((request) => request.kind)).toEqual([
      "background",
      "subject",
      "effect",
    ]);
    expect(plan.every((request) => request.target === "document")).toBe(true);
    expect(plan.find((request) => request.layerId === "subject-image"))
      .toMatchObject({
        width: 760,
        height: 980,
        hasAlpha: true,
        alphaMode: "embedded",
      });
  });

  it("单层重生成请求应允许已生成资产再次进入 provider seam", () => {
    const document = createSeedDocument();
    const updated = applyLayeredDesignGeneratedAsset(document, {
      layerId: "background-image",
      asset: createGeneratedAsset("background-generated"),
      editedAt: UPDATED_AT,
    });

    const plan = createLayeredDesignAssetGenerationPlan(updated);
    const request = createSingleLayerAssetGenerationRequest(
      updated,
      "background-image",
    );

    expect(plan.map((item) => item.layerId)).toEqual([
      "subject-image",
      "atmosphere-effect",
    ]);
    expect(request).toMatchObject({
      layerId: "background-image",
      assetId: "background-generated",
      target: "layer",
      width: 1080,
      height: 1440,
      hasAlpha: false,
    });
  });

  it("写入生成资产时只替换目标图片层，并把该层标记为 generated", () => {
    const document = createSeedDocument();
    const asset = createGeneratedAsset("subject-generated", {
      kind: "subject",
      width: 760,
      height: 980,
      hasAlpha: true,
      prompt: "生成主体层",
    });

    const updated = applyLayeredDesignGeneratedAsset(document, {
      layerId: "subject-image",
      asset,
      editId: "edit-generated-subject",
      editedAt: UPDATED_AT,
    });
    const subjectLayer = updated.layers.find(
      (layer) => layer.id === "subject-image",
    ) as ImageLayer | undefined;
    const titleLayer = updated.layers.find(
      (layer) => layer.id === "headline-text",
    );

    expect(subjectLayer).toMatchObject({
      assetId: "subject-generated",
      source: "generated",
      x: 160,
      y: 308,
      width: 760,
      height: 930,
      zIndex: 20,
    });
    expect(titleLayer?.type).toBe("text");
    expect(updated.assets.some((item) => item.id === "subject-generated")).toBe(
      true,
    );
    expect(updated.editHistory.at(-1)).toMatchObject({
      id: "edit-generated-subject",
      type: "asset_replaced",
      layerId: "subject-image",
      nextAssetId: "subject-generated",
    });
  });

  it("非图片层不应创建单层生成请求", () => {
    const document = createSeedDocument();

    expect(() =>
      createSingleLayerAssetGenerationRequest(document, "headline-text"),
    ).toThrow("未找到可生成的图片图层：headline-text");
  });
});
