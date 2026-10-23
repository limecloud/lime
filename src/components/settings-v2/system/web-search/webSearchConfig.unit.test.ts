import { expect, it } from "vitest";
import type { Config } from "@/lib/api/appConfig";
import { mergeWebSearchDraft, readWebSearchDraft } from "./webSearchConfig";

const config = {
  language: "ko-KR",
  web_search: {
    engine: "google",
    provider: "duckduckgo_instant",
    multi_search: {
      engines: [
        {
          name: "google",
          url_template: "https://custom.google/?q={query}",
          enabled: false,
        },
        {
          name: "private-a",
          url_template: "https://a.invalid/?q={query}",
          enabled: false,
        },
        {
          name: "private-b",
          url_template: "https://b.invalid/?q={query}",
          enabled: true,
        },
      ],
      timeout_ms: 2345,
    },
  },
  image_gen: {
    default_count: 3,
    image_search_pexels_api_key: "fixture-image-key",
  },
} as Config;

it("editing one custom engine preserves built-in overrides, other custom entries and enabled state", () => {
  const before = structuredClone(config);
  const snapshot = readWebSearchDraft(config);
  const result = mergeWebSearchDraft(
    config,
    {
      ...snapshot,
      mseCustomEngineName: "renamed",
      mseCustomEngineTemplate: "https://new.invalid/?q={query}",
    },
    snapshot,
  );
  expect(result).toEqual({
    ...config,
    web_search: {
      ...config.web_search,
      multi_search: {
        ...config.web_search?.multi_search,
        engines: [
          config.web_search?.multi_search?.engines?.[0],
          {
            name: "renamed",
            url_template: "https://new.invalid/?q={query}",
            enabled: false,
          },
          config.web_search?.multi_search?.engines?.[2],
        ],
      },
    },
  });
  expect(config).toEqual(before);
});

it("clearing the represented custom engine removes only that entry", () => {
  const snapshot = readWebSearchDraft(config);
  const result = mergeWebSearchDraft(
    config,
    { ...snapshot, mseCustomEngineName: "", mseCustomEngineTemplate: "" },
    snapshot,
  );
  expect(result.web_search?.multi_search?.engines).toEqual([
    config.web_search?.multi_search?.engines?.[0],
    config.web_search?.multi_search?.engines?.[2],
  ]);
  expect(result.image_gen).toEqual(config.image_gen);
});

it.each(["private-b", "google"])(
  "a custom rename to existing %s fails without modifying config",
  (name) => {
    const before = structuredClone(config);
    const snapshot = readWebSearchDraft(config);
    expect(() =>
      mergeWebSearchDraft(
        config,
        { ...snapshot, mseCustomEngineName: name },
        snapshot,
      ),
    ).toThrow();
    expect(config).toEqual(before);
  },
);

it("saving edited lists, credentials and numeric limits normalizes only owned changes", () => {
  const snapshot = readWebSearchDraft(config);
  const result = mergeWebSearchDraft(
    config,
    {
      ...snapshot,
      providerPriority: " tavily, invalid-provider, bing_search_api ",
      tavilyApiKey: "  fixture-key  ",
      googleSearchApiKey: " ",
      msePriority: " brave, bing ",
      mseMaxResultsPerEngine: "100",
      mseMaxTotalResults: "-3",
      mseTimeoutMs: "bad",
      pixabayApiKey: "  fixture-pixabay  ",
    },
    snapshot,
  );
  expect(result).toEqual({
    ...config,
    web_search: {
      ...config.web_search,
      provider_priority: ["tavily", "bing_search_api"],
      tavily_api_key: "fixture-key",
      google_search_api_key: null,
      multi_search: {
        ...config.web_search?.multi_search,
        priority: ["brave", "bing"],
        max_results_per_engine: 20,
        max_total_results: 1,
        timeout_ms: 4000,
      },
    },
    image_gen: {
      ...config.image_gen,
      image_search_pixabay_api_key: "fixture-pixabay",
    },
  });
});

it("adding a custom engine keeps the opt-in youcom default disabled", () => {
  const empty = { web_search: { engine: "google" } } as Config;
  const snapshot = readWebSearchDraft(empty);
  const result = mergeWebSearchDraft(
    empty,
    {
      ...snapshot,
      mseCustomEngineName: "custom",
      mseCustomEngineTemplate: "https://c.invalid/?q={query}",
    },
    snapshot,
  );
  const engines = result.web_search?.multi_search?.engines ?? [];
  expect(engines.find((engine) => engine.name === "youcom")).toEqual({
    name: "youcom",
    url_template: "https://api.you.com/v1/agents/search?query={query}",
    enabled: false,
  });
  expect(engines.at(-1)?.name).toBe("custom");
});
