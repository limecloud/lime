import { describe, expect, it } from "vitest";
import { filterMiniMaxCatalogModels } from "./minimaxCatalogPolicy";
import {
  buildProviderModelsFromBackendModelIds,
  buildProviderModelsFromRegistry,
} from "./providerModelsCatalog";

const ids = [
  "MiniMax-M2.7",
  "MiniMax-M3",
  "MiniMax-M3.1-Flash-Preview",
  "MiniMax-M3.1-Flash",
  "abab6.5s-chat",
  "abab5.5-chat",
  "MiniMax-Text-01",
  "speech-2.8-hd",
];

describe("MiniMax discovered catalog choices", () => {
  it.each(["minimax", "minimax-cn"])(
    "keeps current text first and preserves media for %s",
    (providerId) => {
      expect(
        filterMiniMaxCatalogModels(
          providerId,
          ids.map((id) => ({ id })),
        ).map((m) => m.id),
      ).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3", "speech-2.8-hd"]);
    },
  );

  it("does not infer gateway model eligibility", () => {
    const models = ids.map((id) => ({ id }));
    expect(filterMiniMaxCatalogModels("openrouter", models)).toBe(models);
  });

  it("filters discovery while preserving saved legacy and custom IDs", () => {
    const provider = {
      key: "minimax",
      label: "MiniMax",
      registryId: "minimax",
      models: [
        "MiniMax-M2.7",
        "abab6.5s-chat",
        "MiniMax-Text-01",
        "my-custom-model",
      ],
    };
    const registry = buildProviderModelsFromBackendModelIds(provider, [], ids);
    const ordinary = buildProviderModelsFromRegistry(
      { ...provider, models: [] },
      registry,
      null,
    );
    expect(ordinary.modelIds).toEqual([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
      "speech-2.8-hd",
    ]);
    const saved = buildProviderModelsFromRegistry(provider, registry, null);
    expect(saved.modelIds).toEqual([
      "MiniMax-M2.7",
      "abab6.5s-chat",
      "MiniMax-Text-01",
      "my-custom-model",
      ...ordinary.modelIds,
    ]);
    expect(provider.models).toEqual([
      "MiniMax-M2.7",
      "abab6.5s-chat",
      "MiniMax-Text-01",
      "my-custom-model",
    ]);
    for (const id of provider.models.filter((id) => id !== "my-custom-model")) {
      expect(saved.models.find((model) => model.id === id)).toBe(
        registry.find((model) => model.id === id),
      );
    }
  });
});
