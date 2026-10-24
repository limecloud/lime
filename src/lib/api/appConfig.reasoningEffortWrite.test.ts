import { beforeEach, expect, it, vi } from "vitest";
import {
  invalidateAppConfigCache,
  writeConfigValue,
  writeReasoningEffortPreferences,
} from "./appConfig";
import { MODEL_REASONING_EFFORTS } from "@/lib/model/modelReasoningPolicy";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

let config: Record<string, unknown>, version: number;
let models: { isDefault: boolean; defaultReasoningEffort: unknown }[];
const file = "/user/config.yaml";
const writes = () =>
  request.mock.calls
    .filter(([method]) => method === "config/value/write")
    .map(([, params]) => params);
const without = (effort: string) =>
  MODEL_REASONING_EFFORTS.filter((value) => value !== effort);

beforeEach(() => {
  vi.resetAllMocks();
  invalidateAppConfigCache();
  config = {
    default_provider: "fixture",
    model_reasoning_effort: "ultra",
    desktop: { "enabled-reasoning-efforts": [...MODEL_REASONING_EFFORTS] },
    language: "ja-JP",
  };
  version = 1;
  models = [
    { isDefault: false, defaultReasoningEffort: "high" },
    { isDefault: true, defaultReasoningEffort: "medium" },
  ];
  request.mockImplementation(async (method, params) => {
    if (method === "model/list") return { result: { data: models } };
    if (method === "config/read")
      return {
        result: {
          config: structuredClone(config),
          origins: {},
          layers: [
            {
              name: { type: "user", file },
              config: structuredClone(config),
              version: `v${version}`,
            },
          ],
        },
      };
    if (method !== "config/value/write") throw Error(`Unexpected ${method}`);
    if (params.expectedVersion !== `v${version}`)
      throw Error("version conflict");
    if (params.keyPath === "desktop.enabled-reasoning-efforts")
      config.desktop = { "enabled-reasoning-efforts": params.value };
    else config[params.keyPath] = params.value;
    ++version;
    return { result: { status: "ok", filePath: file, version: `v${version}` } };
  });
});

it.each(["max", "ultra"])(
  "disabling the global %s default saves the canonical model default before preferences",
  async (effort) => {
    config.model_reasoning_effort = effort;
    const result = await writeReasoningEffortPreferences(without(effort));
    expect(
      writes().map(({ keyPath, value, expectedVersion }) => [
        keyPath,
        value,
        expectedVersion,
      ]),
    ).toEqual([
      ["model_reasoning_effort", "medium", "v1"],
      ["desktop.enabled-reasoning-efforts", without(effort), "v2"],
    ]);
    expect(writes().every((write) => write.filePath === file)).toBe(true);
    expect(
      request.mock.calls
        .filter(([method]) => method === "config/read")
        .every(([, params]) => params.cwd == null),
    ).toBe(true);
    expect(result.config.model_reasoning_effort).toBe("medium");
    expect(result.config.language).toBe("ja-JP");
  },
);

it.each(["high", null, "max"])(
  "leaves an unrelated global default %s unchanged",
  async (effort) => {
    config.model_reasoning_effort = effort;
    await writeReasoningEffortPreferences(without("ultra"));
    expect(writes().map(({ keyPath }) => keyPath)).toEqual([
      "desktop.enabled-reasoning-efforts",
    ]);
    expect(request.mock.calls.some(([method]) => method === "model/list")).toBe(
      false,
    );
    expect(config.model_reasoning_effort).toBe(effort);
  },
);

it.each([null, "custom", ""])(
  "does not invent a fallback for an unknown model default %s",
  async (fallback) => {
    models[1].defaultReasoningEffort = fallback;
    await writeReasoningEffortPreferences(without("ultra"));
    expect(writes().map(({ keyPath }) => keyPath)).toEqual([
      "desktop.enabled-reasoning-efforts",
    ]);
    expect(config.model_reasoning_effort).toBe("ultra");
  },
);

it("does not choose another provider when the canonical default is missing", async () => {
  models = models.filter((model) => !model.isDefault);
  await writeReasoningEffortPreferences(without("ultra"));
  expect(writes()).toHaveLength(1);
  expect(config.model_reasoning_effort).toBe("ultra");
});

it("keeps preferences unchanged if correcting the default fails and retries with fresh state", async () => {
  const serve = request.getMockImplementation()!;
  let failed = false;
  request.mockImplementation(async (method, params) => {
    if (!failed && method === "config/value/write") {
      failed = true;
      throw Error("default IO failure");
    }
    return serve(method, params);
  });
  await expect(
    writeReasoningEffortPreferences(without("ultra")),
  ).rejects.toThrow("default IO failure");
  expect(writes().map(({ keyPath }) => keyPath)).toEqual([
    "model_reasoning_effort",
  ]);
  expect(config.desktop).toEqual({
    "enabled-reasoning-efforts": [...MODEL_REASONING_EFFORTS],
  });
  await writeReasoningEffortPreferences(without("ultra"));
  expect(config.model_reasoning_effort).toBe("medium");
  expect(config.desktop).toEqual({
    "enabled-reasoning-efforts": without("ultra"),
  });
});

it("keeps a corrected default after preference failure and retries only the preference", async () => {
  const serve = request.getMockImplementation()!;
  let failed = false;
  request.mockImplementation(async (method, params) => {
    if (
      !failed &&
      method === "config/value/write" &&
      params.keyPath === "desktop.enabled-reasoning-efforts"
    ) {
      failed = true;
      throw Error("preference IO failure");
    }
    return serve(method, params);
  });
  await expect(
    writeReasoningEffortPreferences(without("ultra")),
  ).rejects.toThrow("preference IO failure");
  expect(config.model_reasoning_effort).toBe("medium");
  await writeReasoningEffortPreferences(without("ultra"));
  expect(writes().map(({ keyPath }) => keyPath)).toEqual([
    "model_reasoning_effort",
    "desktop.enabled-reasoning-efforts",
    "desktop.enabled-reasoning-efforts",
  ]);
  expect(
    request.mock.calls.filter(([method]) => method === "model/list"),
  ).toHaveLength(1);
});

it("rejects an external revision change during catalog lookup without overwriting the new default", async () => {
  const serve = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => {
    if (method === "model/list") {
      config.model_reasoning_effort = "high";
      ++version;
    }
    return serve(method, params);
  });
  await expect(
    writeReasoningEffortPreferences(without("ultra")),
  ).rejects.toThrow("version conflict");
  expect(config.model_reasoning_effort).toBe("high");
  expect(writes()).toHaveLength(1);
  expect(writes()[0].expectedVersion).toBe("v1");
});

it("keeps both writes together in the existing shared mutation queue", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const serve = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => {
    if (
      method === "config/value/write" &&
      params.keyPath === "model_reasoning_effort"
    )
      await gate;
    return serve(method, params);
  });
  const first = writeReasoningEffortPreferences(without("ultra"));
  const other = writeConfigValue({
    keyPath: "model_verbosity",
    value: "high",
    filePath: file,
  });
  await vi.waitFor(() => expect(writes()).toHaveLength(1));
  release();
  await Promise.all([first, other]);
  expect(
    writes().map(({ keyPath, expectedVersion }) => [keyPath, expectedVersion]),
  ).toEqual([
    ["model_reasoning_effort", "v1"],
    ["desktop.enabled-reasoning-efforts", "v2"],
    ["model_verbosity", "v3"],
  ]);
});
