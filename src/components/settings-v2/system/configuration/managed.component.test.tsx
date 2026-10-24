import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppConfigSnapshot } from "@/lib/api/appConfig";
import { ConfigurationPanel } from ".";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  efforts: vi.fn(),
  subscribe: vi.fn(),
  models: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfigSnapshot: api.read,
  writeConfigValue: api.write,
  writeReasoningEffortPreferences: api.efforts,
  subscribeAppConfigChanged: api.subscribe,
  configLayerFile: (layer: AppConfigSnapshot["layer"]) =>
    layer.name.type === "user" ? layer.name.file : null,
}));
vi.mock("@/lib/api/primaryRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/primaryRuntime")>()),
  primaryRuntime: {
    diagnoseDependencies: async () => ({
      supported: true,
      enabled: true,
      installed: false,
      expectedVersion: "fixture-1",
      bundleVersion: null,
      problems: [],
      update: null,
    }),
  },
}));
vi.mock("@/lib/api/configRequirements", () => ({
  getConfigRequirements: async () => null,
}));
vi.mock("@/lib/api/project", () => ({ getDefaultProject: async () => null }));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: api.models,
    subscribeModelRegistryUpdates: () => () => undefined,
  },
}));

let root: Root,
  container: HTMLDivElement,
  snapshot: AppConfigSnapshot,
  changed: () => void;
const control = (field: string) =>
  container.querySelector<HTMLButtonElement>(
    `#configuration-${field} button[aria-haspopup],#configuration-${field} button[role=switch]`,
  )!;
beforeEach(async () => {
  vi.resetAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  const user = {
    name: { type: "user" as const, file: "/user/config.yaml" },
    version: "u1",
    config: { model_verbosity: "low", sandbox_mode: "read-only" },
  };
  const name = {
    type: "mdm" as const,
    domain: "com.limecloud.lime",
    key: "config_toml_base64",
  };
  snapshot = {
    layer: user,
    layers: [
      user,
      {
        name,
        version: "m1",
        config: {
          model_verbosity: "high",
          sandbox_mode: "workspace-write",
          sandbox_workspace_write: { network_access: false },
          desktop: { "enabled-reasoning-efforts": [] },
        },
      },
    ],
    config: {
      default_provider: "openai",
      model_verbosity: "high",
      sandbox_mode: "workspace-write",
      sandbox_workspace_write: { network_access: false },
      desktop: { "enabled-reasoning-efforts": [] },
    },
    origins: Object.fromEntries(
      [
        "model_verbosity",
        "sandbox_mode",
        "sandbox_workspace_write.network_access",
        "desktop.enabled-reasoning-efforts",
      ].map((key) => [key, { name, version: "m1" }]),
    ),
  } as AppConfigSnapshot;
  api.read.mockImplementation(async () => structuredClone(snapshot));
  api.subscribe.mockImplementation((fn) => {
    changed = fn;
    return () => undefined;
  });
  api.models.mockResolvedValue([
    { reasoning_policy: { supported_reasoning_efforts: ["max"] } },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function mount() {
  await act(async () => root.render(<ConfigurationPanel />));
}
async function scope(label: string) {
  const trigger = container
    .querySelector<HTMLElement>("#configuration-scope-value")!
    .closest("button")!;
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ].find((item) => item.textContent === label)!;
  expect(item).toBeDefined();
  await act(async () => item.click());
}

it("shows managed canonical values and locks only fields with administrator origins in User scope", async () => {
  await mount();
  expect(control("model_verbosity").textContent).toBe("High");
  expect(control("sandbox_mode").textContent).toBe("Workspace write");
  for (const key of [
    "model_verbosity",
    "sandbox_mode",
    "sandbox_workspace_write-network_access",
    "reasoning-efforts",
  ])
    expect(control(key).disabled, key).toBe(true);
  expect(control("approval_policy").disabled).toBe(false);
  expect(control("model_reasoning_summary").disabled).toBe(false);
  expect(container.textContent).toContain(
    "This setting is managed by your system administrator.",
  );
  expect(api.write).not.toHaveBeenCalled();
});

it("offers Admin only for a real layer, keeps its identity distinct from User, and hides file opening", async () => {
  await mount();
  await scope("Admin");
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("Admin");
  expect(control("approval_policy").disabled).toBe(true);
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.startsWith("Open "),
    ),
  ).toBe(false);
  await scope("User");
  expect(control("approval_policy").disabled).toBe(false);
  expect(api.write).not.toHaveBeenCalled();
});

it("falls back to User and restores editing when the administrator layer is removed", async () => {
  await mount();
  await scope("Admin");
  const managedLayers = snapshot.layers;
  snapshot.layers = [snapshot.layer];
  snapshot.config = { ...snapshot.config, model_verbosity: "low" };
  snapshot.origins = {};
  await act(async () => changed());
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("User");
  expect(control("model_verbosity").textContent).toBe("Low");
  expect(control("model_verbosity").disabled).toBe(false);
  snapshot.layers = managedLayers;
  await act(async () => changed());
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("User");
});

it.each([
  ["zh-CN", "管理员"],
  ["zh-TW", "管理員"],
  ["en-US", "Admin"],
  ["ja-JP", "管理者"],
  ["ko-KR", "관리자"],
])(
  "renders the administrator scope and lock explanation in %s",
  async (locale, label) => {
    await changeLimeLocale(locale);
    await mount();
    await scope(label);
    expect(container.textContent).not.toContain("settings.configuration.");
    expect(control("model_verbosity").disabled).toBe(true);
  },
);
