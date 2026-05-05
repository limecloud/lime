import { describe, expect, it } from "vitest";
import {
  createLayeredDesignImageRuntimeContract,
  isGptImage2Model,
  normalizeLayeredDesignImageTaskSize,
  resolveLayeredDesignAlphaPolicy,
} from "./imageModelCapabilities";
import type { LayeredDesignAssetGenerationRequest } from "./generation";

function createGenerationRequest(
  overrides: Partial<LayeredDesignAssetGenerationRequest> = {},
): LayeredDesignAssetGenerationRequest {
  return {
    id: "design-1:subject:asset-subject",
    documentId: "design-1",
    layerId: "subject",
    assetId: "asset-subject",
    kind: "subject",
    prompt: "生成主体层",
    width: 1080,
    height: 1440,
    hasAlpha: true,
    alphaMode: "embedded",
    target: "layer",
    ...overrides,
  };
}

describe("layered-design image model capabilities", () => {
  it("应识别 gpt-image-2 与 Lime 内部 gpt-images-2 别名", () => {
    expect(isGptImage2Model("gpt-image-2")).toBe(true);
    expect(isGptImage2Model("gpt-images-2")).toBe(true);
    expect(isGptImage2Model("openai/gpt-images-2")).toBe(true);
    expect(isGptImage2Model("gpt-image-1")).toBe(false);
  });

  it("应按 gpt-image-2 约束把图层尺寸归一到 16 倍数与合法像素范围", () => {
    expect(
      normalizeLayeredDesignImageTaskSize({
        width: 1080,
        height: 1440,
        model: "gpt-image-2",
      }),
    ).toMatchObject({
      width: 1088,
      height: 1440,
      size: "1088x1440",
      adjusted: true,
      modelFamily: "openai-gpt-image-2",
      sizePolicy: "flexible_pixels",
    });

    const small = normalizeLayeredDesignImageTaskSize({
      width: 512,
      height: 512,
      model: "gpt-images-2",
    });
    expect(small.width % 16).toBe(0);
    expect(small.height % 16).toBe(0);
    expect(small.width * small.height).toBeGreaterThanOrEqual(655_360);
  });

  it("应覆盖主流图片模型族，而不是只识别 gpt-image-2", () => {
    expect(
      normalizeLayeredDesignImageTaskSize({
        width: 1080,
        height: 1440,
        model: "gpt-image-1.5",
      }),
    ).toMatchObject({
      width: 1024,
      height: 1536,
      modelFamily: "openai-gpt-image",
      sizePolicy: "allowed_sizes",
    });

    expect(
      normalizeLayeredDesignImageTaskSize({
        width: 3000,
        height: 3000,
        model: "flux-pro",
      }),
    ).toMatchObject({
      modelFamily: "flux",
      sizePolicy: "flexible_pixels",
      adjusted: true,
    });

    expect(
      normalizeLayeredDesignImageTaskSize({
        width: 1025,
        height: 769,
        model: "stable-diffusion-xl",
      }),
    ).toMatchObject({
      width: 1024,
      height: 768,
      modelFamily: "stable-diffusion",
      sizePolicy: "multiple_pixels",
      adjusted: true,
    });

    expect(
      normalizeLayeredDesignImageTaskSize({
        width: 1080,
        height: 1440,
        model: "seedream-4.0",
      }),
    ).toMatchObject({
      width: 1080,
      height: 1440,
      modelFamily: "seedream",
      sizePolicy: "provider_passthrough",
      adjusted: false,
    });
  });

  it("应为 gpt-image-2 透明图层标记 chroma-key 后处理策略", () => {
    expect(
      resolveLayeredDesignAlphaPolicy({
        hasAlpha: true,
        model: "gpt-image-2",
      }),
    ).toEqual({
      requested: true,
      strategy: "chroma_key_postprocess",
      chromaKeyColor: "#00ff00",
      postprocessRequired: true,
    });
  });

  it("应把尺寸与 alpha 策略写入 image task runtimeContract，且不发明新命令协议", () => {
    const request = createGenerationRequest();
    const taskSize = normalizeLayeredDesignImageTaskSize({
      width: request.width,
      height: request.height,
      model: "gpt-image-2",
    });

    expect(
      createLayeredDesignImageRuntimeContract({
        documentId: "design-1",
        request,
        model: "gpt-image-2",
        providerId: "openai",
        taskSize,
      }),
    ).toEqual({
      contract_key: "image_generation",
      layered_design: {
        document_id: "design-1",
        layer_id: "subject",
        asset_id: "asset-subject",
        model_family: "openai-gpt-image-2",
        provider_id: "openai",
        size_policy: "flexible_pixels",
        requested_size: {
          width: 1080,
          height: 1440,
        },
        task_size: {
          width: 1088,
          height: 1440,
        },
        size_adjusted: true,
        capabilities: {
          native_transparency: false,
          image_edit: true,
          mask: false,
          reference_images: true,
        },
        alpha: {
          requested: true,
          strategy: "chroma_key_postprocess",
          chromaKeyColor: "#00ff00",
          postprocessRequired: true,
        },
      },
    });
  });
});
