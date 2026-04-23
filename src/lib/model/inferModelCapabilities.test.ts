import { describe, expect, it } from "vitest";
import {
  getModelOutputModalities,
  getModelTaskFamilies,
  inferModelCapabilities,
  inferModelTaskFamilies,
  inferVisionCapability,
} from "./inferModelCapabilities";

describe("inferModelCapabilities", () => {
  it("应将 gpt-5.4 识别为支持视觉的模型", () => {
    expect(
      inferVisionCapability({
        modelId: "gpt-5.4",
        providerId: "codex",
      }),
    ).toBe(true);
  });

  it("应避免将生图模型误判为视觉聊天模型", () => {
    expect(
      inferVisionCapability({
        modelId: "gemini-3-pro-image-preview",
        providerId: "gemini",
      }),
    ).toBe(false);
  });

  it("应保留 thinking 模型的推理能力推断", () => {
    expect(
      inferModelCapabilities({
        modelId: "gpt-5.4-thinking",
        providerId: "openai",
      }),
    ).toMatchObject({
      vision: true,
      reasoning: true,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
    });
  });

  it("应将 gpt-images-2 识别为图片生成模型而非视觉理解模型", () => {
    expect(
      inferModelTaskFamilies({
        modelId: "gpt-images-2",
        providerId: "new-api",
        providerType: "openai",
      }),
    ).toContain("image_generation");
    expect(
      inferModelTaskFamilies({
        modelId: "gpt-images-2",
        providerId: "new-api",
        providerType: "openai",
      }),
    ).not.toContain("vision_understanding");
  });

  it("应从统一 schema 解析图片模型的输出模态", () => {
    expect(
      getModelOutputModalities({
        id: "gpt-image-1",
        provider_id: "openai",
        family: null,
        description: "OpenAI image generation model",
        source: "embedded",
        capabilities: {
          vision: false,
          tools: false,
          streaming: true,
          json_mode: false,
          function_calling: false,
          reasoning: false,
        },
        task_families: ["image_generation"],
        input_modalities: ["text"],
        output_modalities: ["image"],
      }),
    ).toEqual(["image"]);
  });

  it("缺少显式 schema 时仍应把多模态聊天模型识别为视觉理解 + 对话", () => {
    expect(
      getModelTaskFamilies({
        id: "gpt-4o",
        provider_id: "openai",
        family: "gpt-4o",
        description: null,
        source: "embedded",
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: false,
        },
      }),
    ).toEqual(expect.arrayContaining(["chat", "vision_understanding"]));
  });
});
