import { describe, expect, it } from "vitest";
import {
  findImageProviderById,
  findImageProviderForSelection,
  getImageModelsForProvider,
  isImageProvider,
  pickImageModelBySelection,
  type ImageProviderCandidate,
} from "./imageGeneration";

interface MockProvider extends ImageProviderCandidate {
  name: string;
}

const providers: MockProvider[] = [
  { id: "new-api", type: "openai", name: "OpenAI 兼容" },
  { id: "doubao-image", type: "openai", name: "即梦" },
  { id: "kling", type: "openai", name: "可灵" },
];

describe("imageGeneration", () => {
  it("应识别图片 Provider", () => {
    expect(isImageProvider("new-api", "openai")).toBe(true);
    expect(isImageProvider("fal", "fal")).toBe(true);
    expect(isImageProvider("tts-only", "audio")).toBe(false);
  });

  it("应按项目配置优先匹配指定 Provider", () => {
    expect(findImageProviderById(providers, "doubao-image")?.name).toBe("即梦");
    expect(findImageProviderById(providers, "missing-provider")).toBeNull();
  });

  it("应按预设模型偏好自动选择 Provider", () => {
    expect(findImageProviderForSelection(providers, "basic")?.id).toBe(
      "new-api",
    );
    expect(findImageProviderForSelection(providers, "jimeng")?.id).toBe(
      "doubao-image",
    );
    expect(findImageProviderForSelection(providers, "kling")?.id).toBe("kling");
  });

  it("应按预设模型偏好自动选择模型", () => {
    expect(pickImageModelBySelection([], "basic")).toBe("gpt-image-1");
    expect(
      pickImageModelBySelection(["flux-pro", "gpt-image-1"], "basic"),
    ).toBe("gpt-image-1");
    expect(pickImageModelBySelection([], "jimeng")).toBe("seedream-3.0");
  });

  it("应解析 Provider 可用模型列表", () => {
    expect(getImageModelsForProvider("new-api", "openai")[0]?.id).toBe(
      "dall-e-3",
    );
    expect(
      getImageModelsForProvider("custom-provider", "openai", ["gpt-image-1"])[0]
        ?.id,
    ).toBe("gpt-image-1");
  });

  it("Fal Provider 的自定义模型应过滤掉文本模型并回退到内置图片模型", () => {
    const models = getImageModelsForProvider(
      "fal",
      "openai",
      ["gpt-5.2-pro"],
      "https://fal.run/fal-ai",
    );

    expect(models[0]?.id).toBe("fal-ai/nano-banana-pro");
    expect(models.some((model) => model.id === "gpt-5.2-pro")).toBe(false);
  });

  it("Fal Provider 的合法图片模型应继续保留", () => {
    const models = getImageModelsForProvider(
      "fal",
      "openai",
      ["gpt-5.2-pro", "fal-ai/flux-kontext/dev"],
      "https://fal.run/fal-ai",
    );

    expect(models.map((model) => model.id)).toEqual([
      "fal-ai/flux-kontext/dev",
    ]);
  });
});
