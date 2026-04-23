import { describe, expect, it } from "vitest";
import {
  createOemCloudModelMetadata,
  inferOemCloudModelTaskFamiliesFromAbilities,
} from "./oemCloudModelMetadata";

describe("oemCloudModelMetadata", () => {
  it("应将 llm / vlm 等旧能力别名归一到统一 task families", () => {
    expect(
      inferOemCloudModelTaskFamiliesFromAbilities([
        "llm",
        "vlm",
        "image_generation",
      ]),
    ).toEqual(["chat", "vision_understanding", "image_generation"]);
  });

  it("应在空 abilities 时根据上游映射识别 gpt-images-2 并标记 OEM 别名来源", () => {
    const metadata = createOemCloudModelMetadata({
      id: "model-001",
      offerId: "offer-001",
      modelId: "relay-image-prod",
      displayName: "Relay Image Prod",
      abilities: [],
      recommended: true,
      status: "active",
      sort: 10,
      upstreamMapping: "openai/gpt-images-2",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    });

    expect(metadata).toMatchObject({
      task_families: ["image_generation"],
      output_modalities: ["image"],
      deployment_source: "oem_cloud",
      management_plane: "oem_control_plane",
      canonical_model_id: "openai/gpt-images-2",
      provider_model_id: "relay-image-prod",
      alias_source: "oem",
    });
  });

  it("应优先使用服务端直接下发的 taxonomy，而不是退回旧 abilities", () => {
    const metadata = createOemCloudModelMetadata({
      id: "model-002",
      offerId: "offer-001",
      modelId: "hub-model-002",
      displayName: "Hub Model 002",
      abilities: ["chat", "vision_understanding"],
      task_families: ["image_generation"],
      input_modalities: ["text"],
      output_modalities: ["image"],
      runtime_features: ["images_api"],
      canonical_model_id: "openai/gpt-images-2",
      alias_source: "oem",
      recommended: false,
      status: "active",
      sort: 20,
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    });

    expect(metadata).toMatchObject({
      task_families: ["image_generation"],
      input_modalities: ["text"],
      output_modalities: ["image"],
      runtime_features: ["images_api"],
    });
  });
});
