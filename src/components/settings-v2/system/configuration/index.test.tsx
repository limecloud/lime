import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppConfigSnapshot } from "@/lib/api/appConfig";
import { ConfigurationPanel } from ".";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  writeEfforts: vi.fn(),
  subscribe: vi.fn(),
  targets: vi.fn(),
  open: vi.fn(),
  external: vi.fn(),
  models: vi.fn(),
  modelSubscribe: vi.fn(),
  workspace: vi.fn(),
  requirements: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfigSnapshot: api.read,
  writeConfigValue: api.write,
  writeReasoningEffortPreferences: api.writeEfforts,
  subscribeAppConfigChanged: api.subscribe,
  configLayerFile: (
    layer:
      | AppConfigSnapshot["layer"]
      | { name: { type: "project"; dotCodexFolder: string } },
  ) =>
    layer.name.type === "project"
      ? `${layer.name.dotCodexFolder}/config.toml`
      : layer.name.file,
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
  getConfigRequirements: api.requirements,
}));
vi.mock("@/lib/api/project", () => ({ getDefaultProject: api.workspace }));
vi.mock("@/lib/api/openIn", () => ({
  openIn: { getTargets: api.targets, open: api.open },
}));
vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: api.external,
}));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: api.models,
    subscribeModelRegistryUpdates: api.modelSubscribe,
  },
}));
let root: Root,
  container: HTMLDivElement,
  config: Record<string, unknown>,
  readonly: boolean;
let changed: () => void;
const snapshot = () =>
  ({
    config: structuredClone(config),
    origins: {},
    layer: {
      name: { type: "user", file: "/user/config.yaml" },
      version: "v1",
      config: structuredClone(config),
      disabledReason: readonly ? "managed" : null,
    },
  }) as AppConfigSnapshot;
const row = (field: string) =>
  container.querySelector<HTMLElement>(`#configuration-${field}`)!;
const control = (field: string) =>
  row(field).querySelector<HTMLButtonElement>(
    "button[aria-haspopup],button[role=switch]",
  )!;
async function choose(field: string, label: string) {
  const trigger = control(field);
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ].find((option) => option.textContent?.startsWith(label));
  expect(item, label).toBeDefined();
  await act(async () => item!.click());
}
async function mount() {
  await act(async () => root.render(<ConfigurationPanel />));
}
async function click(text: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === text)!;
  expect(button, text).toBeDefined();
  await act(async () => button.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  readonly = false;
  api.requirements.mockResolvedValue(null);
  api.workspace.mockResolvedValue(null);
  config = {
    default_provider: "fixture",
    approval_policy: "on-request",
    sandbox_mode: "read-only",
    model_verbosity: null,
    model_reasoning_summary: "auto",
    sandbox_workspace_write: { network_access: false },
  };
  api.read.mockImplementation(async () => snapshot());
  api.models.mockResolvedValue([]);
  api.modelSubscribe.mockReturnValue(vi.fn());
  api.write.mockImplementation(async ({ keyPath, value }) => {
    if (keyPath === "sandbox_workspace_write.network_access")
      config.sandbox_workspace_write = { network_access: value };
    else config[keyPath] = value;
    return snapshot();
  });
  api.writeEfforts.mockImplementation(async (value) => {
    config.desktop = { "enabled-reasoning-efforts": value };
    return snapshot();
  });
  api.subscribe.mockImplementation((listener) => {
    changed = listener;
    return vi.fn();
  });
  api.targets.mockResolvedValue({
    preferredTarget: "app:/Editor.app",
    targets: [
      {
        id: "app:/Editor.app",
        available: true,
        target: "systemDefault",
        appPath: "/Editor.app",
      },
    ],
  });
  api.open.mockResolvedValue(undefined);
  api.external.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

async function chooseScope(label: string) {
  const trigger = container
    .querySelector("#configuration-scope-value")!
    .closest("button")!;
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const option = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ].find((item) => item.textContent?.startsWith(label));
  expect(document.querySelector("[role=menu]")?.textContent).toContain(
    "Project configuration",
  );
  expect(document.querySelector("[role=menu] [role=separator]")).not.toBeNull();
  expect(option, label).toBeDefined();
  await act(async () => option!.click());
}

function scopedSnapshot(
  project: Record<string, unknown>,
  disabledReason?: string,
): AppConfigSnapshot {
  const user = snapshot();
  return {
    ...user,
    config: { ...user.config, ...project },
    layers: [
      user.layer,
      {
        name: { type: "project", dotCodexFolder: "/workspace/repo/.lime" },
        version: "project-v1",
        config: project,
        disabledReason,
      },
    ],
  } as AppConfigSnapshot;
}

it("defaults to the actual project layer, inherits omitted values and writes the chosen file with its revision", async () => {
  let project: Record<string, unknown> = {
    model_verbosity: "high",
    sandbox_mode: "workspace-write",
  };
  api.workspace.mockResolvedValue({ rootPath: "/workspace/repo" });
  api.read.mockImplementation(async () => scopedSnapshot(project));
  api.write.mockImplementation(async ({ keyPath, value, filePath }) => {
    if (filePath.includes(".lime")) project = { ...project, [keyPath]: value };
    else config[keyPath] = value;
    return scopedSnapshot(project);
  });
  await mount();
  expect(api.read).toHaveBeenCalledWith({ cwd: "/workspace/repo" });
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("repo");
  expect(control("model_verbosity").textContent).toBe("High");
  expect(control("approval_policy").textContent).toBe("On request");
  expect(row("sandbox_workspace_write-network_access")).not.toBeNull();
  await choose("model_verbosity", "Low");
  expect(api.write).toHaveBeenLastCalledWith({
    keyPath: "model_verbosity",
    value: "low",
    filePath: "/workspace/repo/.lime/config.toml",
    expectedVersion: "project-v1",
    cwd: "/workspace/repo",
  });
  await chooseScope("User");
  expect(control("sandbox_mode").textContent).toBe("Read only");
  expect(row("sandbox_workspace_write-network_access")).toBeNull();
  await choose("approval_policy", "Never");
  expect(api.write).toHaveBeenLastCalledWith({
    keyPath: "approval_policy",
    value: "never",
    filePath: "/user/config.yaml",
    cwd: "/workspace/repo",
  });
  await chooseScope("repo");
  expect(control("model_verbosity").textContent).toBe("Low");
  expect(control("approval_policy").textContent).toBe("Never");
});

it("keeps project errors and pending writes attached to their file when switching scopes", async () => {
  const gate = deferred<AppConfigSnapshot>();
  const project = { model_verbosity: "high" };
  api.workspace.mockResolvedValue({ rootPath: "/workspace/repo" });
  api.read.mockImplementation(async () => scopedSnapshot(project));
  api.write
    .mockReturnValueOnce(gate.promise)
    .mockImplementation(async () => scopedSnapshot(project));
  await mount();
  await choose("model_verbosity", "Low");
  expect(control("model_verbosity").disabled).toBe(true);
  await chooseScope("User");
  expect(control("model_verbosity").disabled).toBe(false);
  await act(async () =>
    gate.resolve(scopedSnapshot({ model_verbosity: "low" })),
  );
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("User");
  expect(control("model_verbosity").textContent).toBe("Model default");
  await chooseScope("repo");
  api.write.mockRejectedValueOnce(Error("conflict"));
  await choose("model_verbosity", "Medium");
  expect(row("model_verbosity").querySelector("[role=alert]")).not.toBeNull();
  await chooseScope("User");
  expect(row("model_verbosity").querySelector("[role=alert]")).toBeNull();
  await chooseScope("repo");
  expect(row("model_verbosity").querySelector("[role=alert]")).not.toBeNull();
  await act(async () =>
    row("model_verbosity")
      .querySelector<HTMLButtonElement>("button.underline")!
      .click(),
  );
  expect(api.write).toHaveBeenLastCalledWith(
    expect.objectContaining({
      value: "medium",
      filePath: "/workspace/repo/.lime/config.toml",
    }),
  );
});

it("disables an untrusted project layer while keeping user scope and global model features editable", async () => {
  api.models.mockResolvedValue([
    {
      reasoning_policy: { supported_reasoning_efforts: ["low", "high", "max"] },
    },
  ]);
  api.workspace.mockResolvedValue({ rootPath: "/workspace/repo" });
  api.read.mockImplementation(async () =>
    scopedSnapshot({ model_verbosity: "high" }, "not trusted"),
  );
  await mount();
  expect(control("model_verbosity").disabled).toBe(true);
  expect(container.textContent).toContain("Trust this project");
  const features = container
    .querySelector("#configuration-reasoning-efforts")
    ?.querySelector("button");
  expect(features?.disabled).toBe(false);
  await chooseScope("User");
  expect(control("model_verbosity").disabled).toBe(false);
  expect(container.textContent).not.toContain("Trust this project");
  expect(api.write).not.toHaveBeenCalled();
});

it("opens the selected project file and keeps model features in the user layer", async () => {
  api.workspace.mockResolvedValue({ rootPath: "/workspace/repo" });
  api.read.mockImplementation(async () =>
    scopedSnapshot({ model_verbosity: "high" }),
  );
  api.models.mockResolvedValue([
    {
      reasoning_policy: {
        supported_reasoning_efforts: ["low", "medium", "high", "ultra"],
      },
    },
  ]);
  await mount();
  await click("Open config.toml");
  expect(api.open).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/workspace/repo/.lime/config.toml",
      openMode: "file",
    }),
  );
  await act(async () =>
    control("reasoning-efforts").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const ultra = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]"),
  ].find((item) => item.textContent === "Ultra")!;
  await act(async () => ultra.click());
  expect(api.writeEfforts).toHaveBeenCalledWith([
    "low",
    "medium",
    "high",
    "xhigh",
    "persistent",
  ]);
  expect(api.write).not.toHaveBeenCalled();
  expect(
    container.querySelector("#configuration-scope-value")?.textContent,
  ).toBe("repo");
  expect(control("model_verbosity").textContent).toBe("High");
});

it("saves all four web search access modes immediately through the public configuration owner", async () => {
  await mount();
  expect(control("web_search").textContent).toBe("Cached");
  for (const [value, label] of [
    ["disabled", "Disabled"],
    ["indexed", "Indexed"],
    ["live", "Live"],
    ["cached", "Cached"],
  ]) {
    await choose("web_search", label);
    expect(api.write).toHaveBeenLastCalledWith({
      keyPath: "web_search",
      value,
      filePath: "/user/config.yaml",
    });
    expect(control("web_search").textContent).toBe(label);
  }
  expect(container.textContent).not.toContain("Save configuration");
});

it("derives an unset search mode from the sandbox and preserves an explicit disabled mode", async () => {
  config.sandbox_mode = "danger-full-access";
  await mount();
  expect(control("web_search").textContent).toBe("Live");
  config.web_search = "disabled";
  await act(async () => changed());
  expect(control("web_search").textContent).toBe("Disabled");
  expect(api.write).not.toHaveBeenCalled();
});

it("keeps the saved search mode on failure and retries the selected access mode", async () => {
  api.write.mockRejectedValueOnce(new Error("write failed"));
  await mount();
  await choose("web_search", "Indexed");
  expect(control("web_search").textContent).toBe("Cached");
  expect(row("web_search").querySelector("[role=alert]")).not.toBeNull();
  await click("Retry");
  expect(control("web_search").textContent).toBe("Indexed");
  expect(row("web_search").querySelector("[role=alert]")).toBeNull();
});

it("renders the real user scope, current values and no manual save or network control in read-only mode", async () => {
  await mount();
  expect(container.querySelector("h1")?.textContent).toBe("Configuration");
  expect(control("approval_policy").textContent).toBe("On request");
  expect(control("model_verbosity").textContent).toBe("Model default");
  expect(control("model_reasoning_summary").textContent).toBe("Auto");
  expect(row("sandbox_workspace_write-network_access")).toBeNull();
  expect(container.textContent).toContain("Open config.yaml");
  expect(container.textContent).not.toContain("Save policy");
  expect(document.querySelectorAll("[role=menuitemradio]")).toHaveLength(0);
});

it("shows real model capabilities and saves an optional reasoning effort immediately", async () => {
  api.models.mockResolvedValue([
    {
      reasoning_policy: {
        supported_reasoning_efforts: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra",
          "persistent",
        ],
      },
    },
  ]);
  await mount();
  const trigger = control("reasoning-efforts");
  expect(trigger.textContent).toBe("6 selected");
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const option = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]")].find(
      (item) => item.textContent === label,
    )!;
  expect(option("Low").getAttribute("data-disabled")).not.toBeNull();
  expect(option("Persistent").getAttribute("aria-checked")).toBe("true");
  expect(option("Maximum").getAttribute("aria-checked")).toBe("false");
  await act(async () => option("Maximum").click());
  expect(api.writeEfforts).toHaveBeenLastCalledWith([
    "low",
    "medium",
    "high",
    "xhigh",
    "ultra",
    "persistent",
    "max",
  ]);
  expect(api.write).not.toHaveBeenCalled();
  expect(trigger.textContent).toBe("7 selected");
});

it("retains confirmed reasoning preference on failure and retries the requested value", async () => {
  api.models.mockResolvedValue([
    {
      reasoning_policy: {
        supported_reasoning_efforts: ["low", "medium", "high", "ultra"],
      },
    },
  ]);
  await mount();
  api.writeEfforts.mockRejectedValueOnce(new Error("IO"));
  await act(async () =>
    control("reasoning-efforts").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const ultra = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]"),
  ].find((item) => item.textContent === "Ultra")!;
  await act(async () => ultra.click());
  expect(ultra.getAttribute("aria-checked")).toBe("true");
  expect(row("reasoning-efforts").querySelector("[role=alert]")).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await click("Retry");
  expect(api.writeEfforts).toHaveBeenLastCalledWith([
    "low",
    "medium",
    "high",
    "xhigh",
    "persistent",
  ]);
  expect(control("reasoning-efforts").textContent).toBe("4 selected");
});

it("does not expose an unsupported optional effort and refreshes real catalog updates", async () => {
  let updated!: () => void;
  api.modelSubscribe.mockImplementation((listener) => {
    updated = listener;
    return vi.fn();
  });
  api.models.mockResolvedValue([
    { reasoning_policy: { supported_reasoning_efforts: ["low", "ultra"] } },
  ]);
  await mount();
  await act(async () =>
    control("reasoning-efforts").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(
    [...document.querySelectorAll("[role=menuitemcheckbox]")].map(
      (item) => item.textContent,
    ),
  ).toEqual(["Low", "Medium", "High", "Extra high", "Ultra"]);
  api.models.mockResolvedValue([
    { reasoning_policy: { supported_reasoning_efforts: ["low"] } },
  ]);
  await act(async () => updated());
  expect(row("reasoning-efforts")).toBeNull();
});

it("shows catalog read errors with a retry and does not fabricate model availability", async () => {
  api.models.mockRejectedValueOnce(new Error("unavailable"));
  await mount();
  expect(control("reasoning-efforts").disabled).toBe(true);
  expect(row("reasoning-efforts").textContent).toContain(
    "Could not load model capabilities",
  );
  api.models.mockResolvedValue([
    { reasoning_policy: { supported_reasoning_efforts: ["max"] } },
  ]);
  await click("Retry");
  expect(control("reasoning-efforts").disabled).toBe(false);
});

it("saves permission defaults immediately and conditionally enables the real workspace network field", async () => {
  await mount();
  await choose("approval_policy", "Never");
  await choose("sandbox_mode", "Workspace write");
  expect(row("sandbox_workspace_write-network_access")).not.toBeNull();
  await act(async () =>
    control("sandbox_workspace_write-network_access").click(),
  );
  expect(
    api.write.mock.calls.map(([input]) => [
      input.keyPath,
      input.value,
      input.filePath,
    ]),
  ).toEqual([
    ["approval_policy", "never", "/user/config.yaml"],
    ["sandbox_mode", "workspace-write", "/user/config.yaml"],
    ["sandbox_workspace_write.network_access", true, "/user/config.yaml"],
  ]);
  await choose("sandbox_mode", "Read only");
  expect(row("sandbox_workspace_write-network_access")).toBeNull();
});

it("saves both output defaults immediately and can reset to the model default", async () => {
  await mount();
  await choose("model_verbosity", "High");
  await choose("model_reasoning_summary", "Detailed");
  await choose("model_verbosity", "Model default");
  expect(
    api.write.mock.calls.map(([input]) => [
      input.keyPath,
      input.value,
      input.filePath,
    ]),
  ).toEqual([
    ["model_verbosity", "high", "/user/config.yaml"],
    ["model_reasoning_summary", "detailed", "/user/config.yaml"],
    ["model_verbosity", null, "/user/config.yaml"],
  ]);
});

it("disables only a pending row and does not show an unconfirmed new value", async () => {
  const gate = deferred<AppConfigSnapshot>();
  api.write.mockReturnValueOnce(gate.promise);
  await mount();
  await choose("model_verbosity", "High");
  expect(control("model_verbosity").disabled).toBe(true);
  expect(control("model_verbosity").textContent).toBe("Model default");
  expect(control("approval_policy").disabled).toBe(false);
  await choose("approval_policy", "Never");
  expect(api.write).toHaveBeenCalledTimes(2);
  config.model_verbosity = "high";
  await act(async () => gate.resolve(snapshot()));
  expect(control("model_verbosity").disabled).toBe(false);
  expect(control("model_verbosity").textContent).toBe("High");
});

it("keeps the confirmed value after a failed save and retries the requested value in the same row", async () => {
  api.write.mockRejectedValueOnce(Error("private-path-and-error"));
  await mount();
  await choose("model_verbosity", "High");
  expect(control("model_verbosity").textContent).toBe("Model default");
  expect(row("model_verbosity").querySelector("[role=alert]")).not.toBeNull();
  expect(row("approval_policy").querySelector("[role=alert]")).toBeNull();
  expect(container.textContent).not.toContain("private-path-and-error");
  await click("Retry");
  expect(control("model_verbosity").textContent).toBe("High");
  expect(container.querySelector("[role=alert]")).toBeNull();
});

it("fails closed on a read failure and recovers using the visible retry", async () => {
  api.read.mockRejectedValueOnce(Error("unavailable"));
  await mount();
  expect(control("approval_policy").disabled).toBe(true);
  expect(api.write).not.toHaveBeenCalled();
  expect(container.querySelector("[role=alert]")).not.toBeNull();
  await click("Retry");
  expect(control("approval_policy").disabled).toBe(false);
});

it("shows a configured legacy approval value without offering it as a current selectable option", async () => {
  config.approval_policy = "untrusted";
  await mount();
  expect(control("approval_policy").textContent).toBe("Untrusted (configured)");
  await act(async () =>
    control("approval_policy").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ].find((node) => node.textContent?.startsWith("Untrusted"));
  expect(item?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => item!.click());
  expect(api.write).not.toHaveBeenCalled();
});

it("supports keyboard menu dismissal and returns focus to the same setting", async () => {
  await mount();
  const trigger = control("model_verbosity");
  trigger.focus();
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const menu = document.querySelector<HTMLElement>("[role=menu]")!;
  expect(menu).not.toBeNull();
  await act(async () =>
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(api.write).not.toHaveBeenCalled();
});

it("dismisses a reopened search menu after each saved mode without another write", async () => {
  await mount();
  for (const label of ["Disabled", "Cached", "Indexed", "Live"]) {
    await choose("web_search", label);
    const writes = api.write.mock.calls.length;
    const trigger = control("web_search");
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const menu = document.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu).not.toBeNull();
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(trigger.textContent).toBe(label);
    expect(api.write).toHaveBeenCalledTimes(writes);
  }
});

it("locks permissions controlled by a default profile while allowing independent output defaults", async () => {
  config.default_permissions = "team-read-only";
  await mount();
  expect(control("sandbox_mode").disabled).toBe(true);
  expect(row("sandbox_mode").textContent).toContain("team-read-only");
  expect(control("model_verbosity").disabled).toBe(false);
});

it("shows the read-only restriction beside the affected controls", async () => {
  readonly = true;
  await mount();
  expect(control("approval_policy").disabled).toBe(true);
  expect(control("sandbox_mode").disabled).toBe(true);
  expect(control("model_verbosity").disabled).toBe(true);
  expect(row("model_verbosity").textContent).toContain("read-only");
});

it("opens the selected real file using the configured available editor and reports host failures", async () => {
  await mount();
  await click("Open config.yaml");
  expect(api.targets).toHaveBeenCalledWith({
    path: "/user/config.yaml",
    deferEnrichment: true,
  });
  expect(api.open).toHaveBeenCalledWith({
    path: "/user/config.yaml",
    openMode: "file",
    target: "systemDefault",
    appPath: "/Editor.app",
  });
  api.open.mockRejectedValueOnce(Error("denied"));
  await click("Open config.yaml");
  expect(container.querySelector("[role=alert]")).not.toBeNull();
  await click("Learn more");
  expect(api.external).toHaveBeenCalledWith(
    "https://github.com/limecloud/lime/blob/main/docs/ops.md",
  );
});

it("refreshes external edits and ignores a late read from an unmounted page", async () => {
  const first = deferred<AppConfigSnapshot>();
  api.read.mockReturnValueOnce(first.promise);
  await mount();
  await act(async () => root.unmount());
  root = createRoot(container);
  config.model_verbosity = "high";
  await mount();
  const older = snapshot();
  older.config.model_verbosity = "low";
  await act(async () => first.resolve(older));
  expect(control("model_verbosity").textContent).toBe("High");
  config.model_verbosity = "medium";
  await act(async () => changed());
  expect(control("model_verbosity").textContent).toBe("Medium");
});

it.each([
  ["zh-CN", "配置"],
  ["zh-TW", "組態"],
  ["en-US", "Configuration"],
  ["ja-JP", "構成"],
  ["ko-KR", "구성"],
])("renders the configuration controls in %s", async (locale, title) => {
  api.models.mockResolvedValue([
    { reasoning_policy: { supported_reasoning_efforts: ["ultra"] } },
  ]);
  await changeLimeLocale(locale);
  await mount();
  expect(container.querySelector("h1")?.textContent).toBe(title);
  expect(container.textContent).not.toContain("settings.configuration.");
  expect(control("reasoning-efforts").textContent).not.toContain(
    "modelFeatures",
  );
  expect(control("model_verbosity").getAttribute("aria-labelledby")).toContain(
    "configuration-model_verbosity-label",
  );
});

it("filters approval, sandbox and search choices using the independent administrator policy", async () => {
  api.requirements.mockResolvedValue({
    allowedApprovalPolicies: ["on-request"],
    allowedSandboxModes: ["read-only", "workspace-write"],
    allowedWebSearchModes: ["disabled", "cached"],
  });
  await mount();
  expect(container.textContent).toContain(
    "Available options are restricted by admin policy.",
  );
  for (const [field, forbidden] of [
    ["approval_policy", "Never"],
    ["sandbox_mode", "Full access"],
    ["web_search", "Live"],
  ]) {
    await act(async () =>
      control(field).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const options = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
    ];
    expect(
      options.some((option) => option.textContent?.startsWith(forbidden)),
    ).toBe(false);
    expect(options.length).toBeGreaterThan(0);
    await act(async () =>
      options[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
  }
  expect(api.write).not.toHaveBeenCalled();
});

it("keeps controls unavailable until both configuration and requirements are loaded", async () => {
  const pending = deferred<null>();
  api.requirements.mockReturnValue(pending.promise);
  await mount();
  expect(
    container.querySelector("[data-testid=configuration-settings]"),
  ).toBeNull();
  expect(api.write).not.toHaveBeenCalled();
  await act(async () => pending.resolve(null));
  expect(control("approval_policy").disabled).toBe(false);
});

it("disables writes on an unreadable policy and restores them only after a successful retry", async () => {
  api.requirements.mockRejectedValueOnce(Error("unreadable system policy"));
  await mount();
  expect(control("approval_policy").disabled).toBe(true);
  expect(container.querySelector("[role=alert]")).not.toBeNull();
  await click("Retry");
  expect(api.requirements).toHaveBeenCalledTimes(2);
  expect(control("approval_policy").disabled).toBe(false);
  expect(api.write).not.toHaveBeenCalled();
});

it("does not let a late unrestricted policy replace a newer restricted response", async () => {
  const old = deferred<null>();
  api.requirements.mockReturnValueOnce(old.promise);
  await mount();
  api.requirements.mockResolvedValue({
    allowedApprovalPolicies: ["on-request"],
    allowedSandboxModes: null,
    allowedWebSearchModes: null,
  });
  await act(async () => changed());
  await act(async () => old.resolve(null));
  expect(container.textContent).toContain(
    "Available options are restricted by admin policy.",
  );
  expect(api.write).not.toHaveBeenCalled();
});
