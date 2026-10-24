import { beforeEach, expect, it, vi } from "vitest";
import type { Config, AppConfigSnapshot } from "./appConfig";
import {
  getConfigSnapshot,
  invalidateAppConfigCache,
  saveConfig,
} from "./appConfig";
import { isConfigFieldManaged, configLayerScope } from "./configLayers";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));
let user: Config;
let revision: number;
const source = {
  type: "mdm" as const,
  domain: "com.limecloud.lime",
  key: "config_toml_base64",
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  invalidateAppConfigCache();
  revision = 1;
  user = {
    default_provider: "openai",
    model_verbosity: "low",
    language: "en-US",
    desktop: { "enabled-reasoning-efforts": ["ultra"] },
  } as Config;
  request.mockImplementation(async (method, params) => {
    if (method === "config/read")
      return {
        result: {
          config: {
            ...user,
            model_verbosity: "high",
            desktop: { ...user.desktop, "enabled-reasoning-efforts": ["max"] },
          },
          layers: [
            {
              name: { type: "user", file: "/user/config.yaml" },
              version: `v${revision}`,
              config: structuredClone(user),
            },
            {
              name: source,
              version: "m1",
              config: {
                model_verbosity: "high",
                desktop: { "enabled-reasoning-efforts": ["max"] },
              },
            },
          ],
          origins: {
            model_verbosity: { name: source, version: "m1" },
            "desktop.enabled-reasoning-efforts.0": {
              name: source,
              version: "m1",
            },
          },
        },
      };
    if (method === "config/batchWrite") {
      for (const edit of params.edits) {
        if (edit.keyPath === "language") user.language = edit.value;
        else if (edit.keyPath === 'desktop."follow-up-suggestions-enabled"')
          if (edit.value === null)
            delete user.desktop!["follow-up-suggestions-enabled"];
          else
            user.desktop = {
              ...user.desktop,
              "follow-up-suggestions-enabled": edit.value,
            };
        else throw Error("administrator readonly");
      }
      return {
        result: {
          status: "ok",
          version: `v${++revision}`,
          filePath: "/user/config.yaml",
        },
      };
    }
    throw Error(`unexpected method ${method}`);
  });
});

it("preserves full managed layers without cwd while keeping the sole writable User snapshot separate", async () => {
  const snapshot = await getConfigSnapshot();
  expect(snapshot.layers).toHaveLength(2);
  expect(snapshot.config.model_verbosity).toBe("high");
  expect(snapshot.layer.config).toMatchObject({ model_verbosity: "low" });
  expect(snapshot.layer.name.type).toBe("user");
  snapshot.layers![1].config = {};
  expect((await getConfigSnapshot()).layers![1].config).toMatchObject({
    model_verbosity: "high",
  });
});

it("saving an independent field never writes effective administrator values back to User", async () => {
  const snapshot = await getConfigSnapshot();
  await saveConfig({ ...snapshot.config, language: "ja-JP" });
  expect(request).toHaveBeenCalledWith("config/batchWrite", {
    edits: [{ keyPath: "language", value: "ja-JP", mergeStrategy: "replace" }],
    expectedVersion: "v1",
    reloadUserConfig: true,
  });
  const saved = await getConfigSnapshot();
  expect(saved.config).toMatchObject({
    language: "ja-JP",
    model_verbosity: "high",
  });
  expect(saved.layer.config).toMatchObject({
    language: "ja-JP",
    model_verbosity: "low",
    desktop: { "enabled-reasoning-efforts": ["ultra"] },
  });
  expect(saved.layer.version).toBe("v2");
});

it("writes only the editable sibling of a managed nested field", async () => {
  const snapshot = await getConfigSnapshot();
  await saveConfig({
    ...snapshot.config,
    desktop: {
      ...snapshot.config.desktop,
      "follow-up-suggestions-enabled": false,
    },
  });
  expect(request).toHaveBeenCalledWith(
    "config/batchWrite",
    expect.objectContaining({
      edits: [
        {
          keyPath: 'desktop."follow-up-suggestions-enabled"',
          value: false,
          mergeStrategy: "replace",
        },
      ],
    }),
  );
  expect(user.desktop?.["enabled-reasoning-efforts"]).toEqual(["ultra"]);
});

it("propagates readonly rejection and reloads the real canonical state", async () => {
  const snapshot = await getConfigSnapshot();
  await expect(
    saveConfig({ ...snapshot.config, model_verbosity: "low" }),
  ).rejects.toThrow("administrator readonly");
  const reloaded = await getConfigSnapshot();
  expect(reloaded.config.model_verbosity).toBe("high");
  expect(reloaded.layer.version).toBe("v1");
});

it("removes an editable sibling while preserving an omitted managed value and the raw User value", async () => {
  user.desktop!["follow-up-suggestions-enabled"] = false;
  const snapshot = await getConfigSnapshot();
  await saveConfig({ ...snapshot.config, desktop: {} });
  expect(request).toHaveBeenCalledWith(
    "config/batchWrite",
    expect.objectContaining({
      edits: [
        {
          keyPath: 'desktop."follow-up-suggestions-enabled"',
          value: null,
          mergeStrategy: "replace",
        },
      ],
    }),
  );
  expect(user.desktop).toEqual({ "enabled-reasoning-efforts": ["ultra"] });
  expect(
    (await getConfigSnapshot()).config.desktop?.["enabled-reasoning-efforts"],
  ).toEqual(["max"]);
});

it("uses canonical origins for ancestor and descendant locks and a stable scope identity", async () => {
  const snapshot: AppConfigSnapshot = await getConfigSnapshot();
  expect(isConfigFieldManaged(snapshot.origins, "desktop")).toBe(true);
  expect(
    isConfigFieldManaged(snapshot.origins, "desktop.enabled-reasoning-efforts"),
  ).toBe(true);
  expect(
    isConfigFieldManaged(
      snapshot.origins,
      "desktop.follow-up-suggestions-enabled",
    ),
  ).toBe(false);
  expect(isConfigFieldManaged({}, "approval_policy")).toBe(false);
  expect(configLayerScope(snapshot.layer)).toBe("/user/config.yaml");
  expect(configLayerScope(snapshot.layers![1])).not.toBe(
    configLayerScope(snapshot.layer),
  );
});
