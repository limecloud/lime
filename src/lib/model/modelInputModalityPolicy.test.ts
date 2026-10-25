import { describe, expect, it } from "vitest";
import {
  buildModelInputModalityPolicy,
  normalizeModelInputModality,
} from "./modelInputModalityPolicy";

describe("modelInputModalityPolicy", () => {
  it("缺少 input_modalities 时使用 Lime 默认值", () => {
    expect(buildModelInputModalityPolicy(null)).toEqual({
      input_modalities: ["text", "image"],
      send_gate_modalities: ["text", "image"],
      unknown_input_modalities: [],
      supports_text_input: true,
      supports_media_input: true,
      supports_image_input: true,
      source: "lime_default",
    });
  });

  it("显式 input_modalities 会收窄能力，不再补默认图片输入", () => {
    expect(
      buildModelInputModalityPolicy({
        input_modalities: ["text"],
      }),
    ).toMatchObject({
      input_modalities: ["text"],
      send_gate_modalities: ["text"],
      supports_media_input: false,
      supports_image_input: false,
      source: "explicit",
    });
  });

  it("支持 opencode / models.dev 风格的 modalities.input 多模态形态", () => {
    expect(
      buildModelInputModalityPolicy({
        modalities: {
          input: ["text", "audio", "video", "pdf"],
          output: ["text"],
        },
      }),
    ).toMatchObject({
      input_modalities: ["text", "audio", "video", "pdf"],
      send_gate_modalities: ["text", "audio", "video", "file"],
      supports_media_input: true,
      supports_image_input: false,
      source: "explicit",
    });
  });

  it("归一大小写、去重并保留未知未来模态", () => {
    expect(normalizeModelInputModality("IMAGE")).toBe("image");
    expect(normalizeModelInputModality("screen-share")).toBeNull();
    expect(
      buildModelInputModalityPolicy({
        inputModalities: ["IMAGE", "image", "screen-share", "screen_share"],
      }),
    ).toMatchObject({
      input_modalities: ["image"],
      send_gate_modalities: ["image"],
      unknown_input_modalities: ["screen_share"],
    });
  });

  it("布尔 map 只读取显式输入模态开关", () => {
    expect(
      buildModelInputModalityPolicy({
        modalities: {
          input: {
            text: true,
            image: false,
            audio: true,
          },
        },
      }),
    ).toMatchObject({
      input_modalities: ["text", "audio"],
      send_gate_modalities: ["text", "audio"],
      supports_media_input: true,
      supports_image_input: false,
    });
  });

  it("不会从任务族、输出模态或媒体总开关推断输入能力", () => {
    expect(
      buildModelInputModalityPolicy({
        input_modalities: ["text"],
        output_modalities: ["image"],
        task_families: ["vision_understanding"],
        supports_media_input: true,
      } as Record<string, unknown>),
    ).toMatchObject({
      input_modalities: ["text"],
      send_gate_modalities: ["text"],
      supports_media_input: false,
      supports_image_input: false,
    });
  });
});
