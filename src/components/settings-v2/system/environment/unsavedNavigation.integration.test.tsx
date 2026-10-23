import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import type {
  Config,
  ConfigUpdater,
  EnvironmentPreview,
} from "@/lib/api/appConfig";
import { SettingsTabs } from "@/types/settings";
import { SettingsNavigationGuard } from "../../_layout/SettingsNavigationGuard";
import { EnvironmentSettings } from ".";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getEnvironmentPreview: vi.fn(),
  saveConfig: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  updateConfig: async (update: ConfigUpdater) => {
    const config = update(await api.getConfig());
    await api.saveConfig(config);
    api.getConfig.mockResolvedValue(config);
    return config;
  },
}));
let navigation: ReturnType<typeof useAppNavigation>;
function Harness() {
  navigation = useAppNavigation();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.Environment }),
    [handleNavigate],
  );
  return (
    <>
      <button
        onClick={() => handleNavigate("settings", { tab: SettingsTabs.About })}
      >
        Section
      </button>
      <button onClick={navigation.returnFromSettings}>Back</button>
      <button
        onClick={() => navigation.startNewConversation({ freshDraft: false })}
      >
        Home
      </button>
      <button onClick={() => handleNavigate("resources")}>Root</button>
      <button
        onClick={() => navigation.startNewConversation({ freshDraft: true })}
      >
        New
      </button>
      {navigation.requestedPage === "settings" &&
      navigation.requestedPageParams?.tab === SettingsTabs.Environment ? (
        <SettingsNavigationGuard navigationGuard={navigation.navigationGuard}>
          <EnvironmentSettings />
        </SettingsNavigationGuard>
      ) : (
        <p data-testid="destination">{navigation.requestedPage}</p>
      )}
    </>
  );
}
let root: Root;
let container: HTMLDivElement;
let initial: Config;
function preview(count = 0): EnvironmentPreview {
  return {
    shellImport: {
      enabled: false,
      status: "disabled",
      message: "",
      importedCount: count,
    },
    entries: [],
  };
}
function button(text: string) {
  const node = [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!node) throw new Error("Missing button " + text);
  return node;
}
function input(id = "environment-shell-import-timeout") {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement))
    throw new Error("Missing input " + id);
  return node;
}
async function edit(value: string, id?: string) {
  await act(async () => {
    const node = input(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = async (node: HTMLElement) => act(async () => node.click());
const dialog = () =>
  document.querySelector('[data-testid="settings-unsaved-changes-dialog"]');
const mount = async () => act(async () => root.render(<Harness />));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  initial = {
    default_provider: "openai",
    environment: {
      shell_import: { enabled: false, timeout_ms: 1500 },
      variables: [{ key: "TEST_VAR", value: "test", enabled: true }],
    },
  } as Config;
  api.getConfig.mockResolvedValue(initial);
  api.getEnvironmentPreview.mockResolvedValue(preview());
  api.saveConfig.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

it.each(["Section", "Back", "Home", "Root", "New"])(
  "%s protects the actual Environment form without persisting",
  async (target) => {
    await mount();
    await edit("2300");
    await click(button(target));
    expect(dialog()).not.toBeNull();
    expect(input().value).toBe("2300");
    await click(button("Keep editing"));
    expect(dialog()).toBeNull();
    expect(input().value).toBe("2300");
    await click(button(target));
    await click(button("Discard changes"));
    expect(
      document.querySelector('[data-testid="destination"]'),
    ).not.toBeNull();
    expect(api.saveConfig).not.toHaveBeenCalled();
  },
);

it("merges edited fields into later configuration and accepts unedited returned fields", async () => {
  await mount();
  await edit("2400");
  const current = {
    ...initial,
    language: "ja-JP",
    environment: {
      ...initial.environment!,
      shell_import: { enabled: true, timeout_ms: 1500 },
    },
  };
  api.getConfig.mockResolvedValue(current);
  await click(button("Save and apply"));
  expect(api.saveConfig).toHaveBeenCalledWith({
    ...current,
    environment: {
      ...current.environment,
      shell_import: { enabled: true, timeout_ms: 2400 },
    },
  });
  expect(input().value).toBe("2400");
  expect(
    document.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
  ).toBe("true");
  await click(button("Section"));
  expect(dialog()).toBeNull();
});

it("rejects duplicate saves and discard while saving, preserving later edits", async () => {
  await mount();
  await edit("2300");
  const pending = deferred<void>();
  api.saveConfig.mockReturnValueOnce(pending.promise);
  await act(async () => {
    button("Save and apply").click();
    button("Save and apply").click();
  });
  expect(api.saveConfig).toHaveBeenCalledTimes(1);
  await edit("2600");
  await click(button("Section"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => navigation.navigationGuard.discardPendingNavigation());
  expect(input().value).toBe("2600");
  await click(button("Keep editing"));
  await act(async () => pending.resolve());
  expect(input().value).toBe("2600");
  expect(dialog()).toBeNull();
  expect(document.querySelector('[data-testid="destination"]')).toBeNull();
  await click(button("Save and apply"));
  expect(api.saveConfig).toHaveBeenCalledTimes(2);
  expect(
    api.saveConfig.mock.calls[1][0].environment.shell_import.timeout_ms,
  ).toBe(2600);
});

it("accepts saved fields while preserving a different field edited in flight", async () => {
  await mount();
  await edit("2400");
  const pending = deferred<void>();
  api.saveConfig.mockReturnValueOnce(pending.promise);
  await click(button("Save and apply"));
  await edit("later", "environment-variable-value-0");
  await act(async () => pending.resolve());
  expect(input().value).toBe("2400");
  expect(input("environment-variable-value-0").value).toBe("later");
  // Reverting only the later edit must leave the confirmed timeout clean.
  await edit("test", "environment-variable-value-0");
  expect(button("Save and apply").disabled).toBe(true);
  await click(button("Section"));
  expect(dialog()).toBeNull();
});

it("keeps failed drafts, hides backend values and offers retry through Save", async () => {
  await mount();
  await edit("2400");
  api.saveConfig.mockRejectedValueOnce(
    new Error("private environment fixture marker"),
  );
  await click(button("Save and apply"));
  expect(input().value).toBe("2400");
  expect(container.textContent).toContain(
    "Failed to save environment settings",
  );
  expect(container.textContent).not.toContain(
    "private environment fixture marker",
  );
  expect(
    [...container.querySelectorAll("button")].some(
      (b) => b.textContent === "Reload",
    ),
  ).toBe(false);
  await click(button("Save and apply"));
  expect(api.saveConfig).toHaveBeenCalledTimes(2);
});

it("disables edits and saving after a load failure and permits initial retry", async () => {
  api.getConfig.mockRejectedValueOnce(new Error("private load marker"));
  await mount();
  expect(input().matches(":disabled")).toBe(true);
  expect(button("Save and apply").disabled).toBe(true);
  expect(container.textContent).not.toContain("private load marker");
  await click(button("Reload"));
  expect(input().matches(":disabled")).toBe(false);
  expect(input().value).toBe("1500");
});

it("retains raw empty timeout until save and normalizes only the submitted draft", async () => {
  await mount();
  await edit("");
  expect(input().value).toBe("");
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
  await click(button("Keep editing"));
  await click(button("Save and apply"));
  expect(input().value).toBe("1500");
  expect(
    api.saveConfig.mock.calls[0][0].environment.shell_import.timeout_ms,
  ).toBe(1500);
});

it("keeps the variable name input mounted and focused during editing", async () => {
  await mount();
  const original = input("environment-variable-key-0");
  original.focus();
  await edit("TEST_EDITED", "environment-variable-key-0");
  expect(input("environment-variable-key-0")).toBe(original);
  expect(document.activeElement).toBe(original);
});

it("refreshes only the preview while retaining the draft", async () => {
  await mount();
  await edit("2700");
  api.getEnvironmentPreview.mockResolvedValueOnce(preview(7));
  await click(button("Refresh preview"));
  expect(input().value).toBe("2700");
  const imported = [...container.querySelectorAll("p")].find(
    (node) =>
      node.textContent ===
      getLimeI18n().t(
        "settings:settings.environment.shellImport.imported.title",
      ),
  );
  expect(imported?.nextElementSibling?.textContent).toBe("7");
  expect(api.saveConfig).not.toHaveBeenCalled();
});

it("ignores an older preview response after saving a newer configuration", async () => {
  await mount();
  const old = deferred<EnvironmentPreview>();
  api.getEnvironmentPreview
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(preview(9));
  await click(button("Refresh preview"));
  await edit("2500");
  await click(button("Save and apply"));
  await act(async () => old.resolve(preview(2)));
  const imported = [...container.querySelectorAll("p")].find(
    (node) =>
      node.textContent ===
      getLimeI18n().t(
        "settings:settings.environment.shellImport.imported.title",
      ),
  );
  expect(imported?.nextElementSibling?.textContent).toBe("9");
});

it("treats preview failure after persistence as a preview error with a clean draft", async () => {
  await mount();
  await edit("2500");
  api.getEnvironmentPreview.mockRejectedValueOnce(
    new Error("private preview marker"),
  );
  await click(button("Save and apply"));
  expect(container.textContent).toContain(
    "Failed to refresh environment preview",
  );
  expect(container.textContent).not.toContain("private preview marker");
  expect(button("Save and apply").disabled).toBe(true);
  await click(button("Section"));
  expect(dialog()).toBeNull();
});

it.each(["save", "preview"])(
  "ignores late %s completion after unmount",
  async (phase) => {
    await mount();
    const save = deferred<void>();
    const read = deferred<EnvironmentPreview>();
    if (phase === "save") api.saveConfig.mockReturnValueOnce(save.promise);
    else api.getEnvironmentPreview.mockReturnValueOnce(read.promise);
    await edit("2500");
    await click(button("Save and apply"));
    const callsBefore = api.getEnvironmentPreview.mock.calls.length;
    await act(async () => root.render(<p>Replacement owner</p>));
    await act(async () => {
      save.resolve();
      read.resolve(preview(8));
    });
    expect(container.textContent).toBe("Replacement owner");
    expect(api.getEnvironmentPreview).toHaveBeenCalledTimes(callsBefore);
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "%s translates failures without reloading edited input",
  async (locale) => {
    await mount();
    await edit("2600");
    await act(async () => changeLimeLocale(locale));
    expect(input().value).toBe("2600");
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    api.saveConfig.mockRejectedValueOnce(new Error("private marker"));
    await click(
      button(getLimeI18n().t("settings:settings.environment.action.save")),
    );
    expect(container.textContent).toContain(
      getLimeI18n().t("settings:settings.environment.message.saveFailed"),
    );
    expect(container.textContent).not.toContain("private marker");
  },
);
