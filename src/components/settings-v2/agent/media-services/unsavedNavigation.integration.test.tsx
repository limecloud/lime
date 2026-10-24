import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  METHOD_CONFIG_BATCH_WRITE,
  METHOD_CONFIG_READ,
  type ConfigBatchWriteParams,
} from "@limecloud/app-server-client";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import * as configApi from "@/lib/api/appConfig";
import {
  getConfig,
  invalidateAppConfigCache,
  updateConfig,
  type Config,
} from "@/lib/api/appConfig";
import { SettingsTabs } from "@/types/settings";
import type { SettingsPageParams } from "@/types/page";
import { SettingsNavigationGuard } from "../../_layout/SettingsNavigationGuard";
import { MediaServicesSettings } from ".";

const api = vi.hoisted(() => ({ request: vi.fn() }));
// 保留真实 config gateway、字段 diff、版本与串行队列，仅替换 transport。
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = api.request;
  },
}));
vi.mock("../image-gen", () => ({ ImageGenSettings: () => null }));
vi.mock("../video-gen", () => ({ VideoGenSettings: () => null }));
vi.mock("../voice", () => ({ VoiceSettings: () => null }));
vi.mock("@/components/input-kit", () => ({
  ModelSelector: () => <span>Model preference</span>,
}));

let navigation: ReturnType<typeof useAppNavigation>;
function Harness() {
  navigation = useAppNavigation();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.MediaServices }),
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
        onClick={() =>
          navigation.startNewConversation({
            projectId: null,
            freshDraft: false,
          })
        }
      >
        Home
      </button>
      <button onClick={() => handleNavigate("resources")}>Root</button>
      <button
        onClick={() =>
          navigation.startNewConversation({ projectId: null, freshDraft: true })
        }
      >
        New
      </button>
      <button
        onClick={() =>
          handleNavigate("settings", {
            tab: SettingsTabs.Configuration,
            searchTarget: "configuration-web_search",
          })
        }
      >
        Search
      </button>
      {navigation.requestedPage === "settings" &&
      (navigation.requestedPageParams as SettingsPageParams)?.tab ===
        SettingsTabs.MediaServices ? (
        <SettingsNavigationGuard navigationGuard={navigation.navigationGuard}>
          <MediaServicesSettings />
        </SettingsNavigationGuard>
      ) : (
        <p data-testid="destination">{navigation.requestedPage}</p>
      )}
    </>
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let persisted: Config;
let version: number;
let writes: ConfigBatchWriteParams[];
let writeGates: ReturnType<typeof deferred>[];
let allGates: ReturnType<typeof deferred>[];
const holdWrite = () => {
  const gate = deferred();
  writeGates.push(gate);
  allGates.push(gate);
  return gate;
};
const button = (text: string) => {
  const node = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error("Missing button " + text);
  return node;
};
const prompt = () => {
  const node = container.querySelector("textarea");
  if (!(node instanceof HTMLTextAreaElement))
    throw new Error("Missing prompt editor");
  return node;
};
const count = () => {
  const node = container.querySelector('input[type="number"]');
  if (!(node instanceof HTMLInputElement))
    throw new Error("Missing image count editor");
  return node;
};
const dialog = () =>
  document.querySelector('[data-testid="settings-unsaved-changes-dialog"]');
const destination = () =>
  container.querySelector('[data-testid="destination"]');
const click = async (node: HTMLElement) => act(async () => node.click());
const mount = async () => act(async () => root.render(<Harness />));
async function edit(
  node: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const blur = async (node: HTMLElement) =>
  act(async () =>
    node.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  await changeLimeLocale("en-US");
  invalidateAppConfigCache();
  version = 1;
  writes = [];
  writeGates = [];
  allGates = [];
  persisted = {
    default_provider: "openai",
    language: "en-US",
    workspace_preferences: {
      schema_version: 2,
      service_models: {
        topic: { preferredProviderId: "openai", preferredModelId: "topic" },
        input_completion: { enabled: true },
        resource_prompt_rewrite: {
          enabled: true,
          preferredProviderId: "openai",
          preferredModelId: "resource",
          customPrompt: "Saved prompt",
        },
      },
    },
    image_gen: { default_count: 2, default_size: "1024x1024" },
  } as Config;
  api.request.mockImplementation(
    async (method: string, params: ConfigBatchWriteParams) => {
      if (method === METHOD_CONFIG_READ)
        return {
          result: {
            config: structuredClone(persisted),
            origins: {},
            layers: [
              {
                name: {
                  type: "user",
                  file: "/tmp/media/config.yaml",
                  profile: null,
                },
                version: String(version),
                config: structuredClone(persisted),
              },
            ],
          },
        };
      expect(method).toBe(METHOD_CONFIG_BATCH_WRITE);
      writes.push(structuredClone(params));
      await writeGates.shift()?.promise;
      expect(params.expectedVersion).toBe(String(version));
      for (const edit of params.edits) {
        expect(edit.mergeStrategy).toBe("replace");
        Object.assign(persisted, { [edit.keyPath]: edit.value });
      }
      version++;
      return {
        result: {
          status: "ok",
          version: String(version),
          filePath: "/tmp/media/config.yaml",
          overriddenMetadata: null,
        },
      };
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    for (const gate of allGates) gate.resolve();
    await updateConfig((config) => config);
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await changeLimeLocale("zh-CN");
});

it.each(["Section", "Back", "Home", "Root", "New", "Search"])(
  "%s protects the unblurred real prompt with Keep/Discard and zero writes",
  async (target) => {
    await mount();
    await edit(prompt(), "Unsubmitted draft");
    await click(button(target));
    expect(dialog()).not.toBeNull();
    expect(prompt().value).toBe("Unsubmitted draft");
    await click(button("Keep editing"));
    expect(dialog()).toBeNull();
    expect(prompt().value).toBe("Unsubmitted draft");
    await click(button(target));
    await click(button("Discard changes"));
    expect(destination()).not.toBeNull();
    expect(writes).toHaveLength(0);
  },
);

it("dialog focus does not turn navigation into an implicit prompt commit", async () => {
  await mount();
  prompt().focus();
  await edit(prompt(), "Keep this raw draft");
  prompt().setSelectionRange(2, 8);
  await act(async () => navigation.handleNavigate("resources"));
  expect(dialog()).not.toBeNull();
  expect(writes).toHaveLength(0);
  await click(button("Keep editing"));
  expect(prompt().value).toBe("Keep this raw draft");
  expect(prompt().selectionStart).toBe(2);
  expect(prompt().selectionEnd).toBe(8);
});

it.each(["", "-"])(
  "retains unfinished image count %j through blur and navigation without a write",
  async (value) => {
    await mount();
    await edit(count(), value);
    const raw = count().value;
    await blur(count());
    expect(count().value).toBe(raw);
    expect(count().getAttribute("aria-invalid")).toBe("true");
    expect(writes).toHaveLength(0);
    await click(button("Section"));
    expect(dialog()).not.toBeNull();
    await click(button("Keep editing"));
    expect(count().value).toBe(raw);
    await edit(count(), "2");
    await click(button("Section"));
    expect(destination()).not.toBeNull();
  },
);

it("locks navigation for a blur save and deduplicates synchronous repeated commits", async () => {
  await mount();
  const update = vi.spyOn(configApi, "updateConfig");
  await edit(prompt(), "First save");
  const gate = holdWrite();
  await act(async () => {
    prompt().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    prompt().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(writes).toHaveLength(1);
  expect(update).toHaveBeenCalledTimes(1);
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => navigation.navigationGuard.discardPendingNavigation());
  expect(destination()).toBeNull();
  await click(button("Keep editing"));
  await act(async () => gate.resolve());
  expect(prompt().value).toBe("First save");
  await click(button("Section"));
  expect(dialog()).toBeNull();
  expect(destination()).not.toBeNull();
  expect(writes).toHaveLength(1);
});

it("keeps both saving fields registered until the last serialized request settles", async () => {
  await mount();
  const first = holdWrite(),
    second = holdWrite();
  await edit(prompt(), "Saved together");
  await blur(prompt());
  await edit(count(), "5");
  await blur(count());
  expect(writes).toHaveLength(1);
  await click(button("Section"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => first.resolve());
  expect(writes).toHaveLength(2);
  expect(button("Discard changes").disabled).toBe(true);
  expect(count().value).toBe("5");
  await act(async () => second.resolve());
  expect(button("Discard changes").disabled).toBe(false);
  await click(button("Keep editing"));
  await click(button("Section"));
  expect(destination()).not.toBeNull();
  invalidateAppConfigCache();
  const reopened = await getConfig();
  expect(reopened.image_gen?.default_count).toBe(5);
  expect(
    reopened.workspace_preferences?.service_models?.resource_prompt_rewrite
      ?.customPrompt,
  ).toBe("Saved together");
  invalidateAppConfigCache();
  await act(async () =>
    navigation.handleNavigate("settings", { tab: SettingsTabs.MediaServices }),
  );
  expect(prompt().value).toBe("Saved together");
  expect(count().value).toBe("5");
});

it("keeps later same-field and different-field edits while accepting only the saved baseline", async () => {
  await mount();
  const gate = holdWrite();
  await edit(prompt(), "  First save  ");
  await blur(prompt());
  await edit(prompt(), "  Later raw prompt  ");
  await edit(count(), "");
  await act(async () => gate.resolve());
  expect(prompt().value).toBe("  Later raw prompt  ");
  expect(count().value).toBe("");
  await edit(prompt(), "First save");
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
  await click(button("Keep editing"));
  await edit(count(), "2");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
  expect(writes).toHaveLength(1);
});

it("keeps raw failed drafts and retries the same blur through the real gateway", async () => {
  await mount();
  const gate = holdWrite();
  await edit(prompt(), "  Retry this raw prompt  ");
  await blur(prompt());
  await act(async () =>
    gate.reject(new Error("private transport fixture marker")),
  );
  expect(prompt().value).toBe("  Retry this raw prompt  ");
  expect(container.textContent).toContain(
    getLimeI18n().t("settings:settings.mediaServices.message.saveFailed"),
  );
  expect(container.textContent).not.toContain(
    "private transport fixture marker",
  );
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
  await click(button("Keep editing"));
  await blur(prompt());
  expect(writes).toHaveLength(2);
  expect(prompt().value).toBe("Retry this raw prompt");
  expect(
    persisted.workspace_preferences?.service_models?.resource_prompt_rewrite
      ?.customPrompt,
  ).toBe("Retry this raw prompt");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it.each(["prompt", "count"])(
  "preserves a newer %s edit that returns to the old baseline during save",
  async (field) => {
    await mount();
    const gate = holdWrite();
    const node = field === "prompt" ? prompt() : count();
    const original = node.value;
    await edit(node, field === "prompt" ? "New persisted prompt" : "5");
    await blur(node);
    await edit(node, original);
    await act(async () => gate.resolve());
    expect(node.value).toBe(original);
    await click(button("Section"));
    expect(dialog()).not.toBeNull();
    expect(button("Discard changes").disabled).toBe(false);
    expect(writes).toHaveLength(1);
  },
);

it("preserves A to B to A commit intent rather than deduplicating an older pending A", async () => {
  await mount();
  const gate = holdWrite();
  for (const text of ["A prompt", "B prompt", "A prompt"]) {
    await edit(prompt(), text);
    await blur(prompt());
  }
  await act(async () => gate.resolve());
  expect(writes).toHaveLength(3);
  expect(
    persisted.workspace_preferences?.service_models?.resource_prompt_rewrite
      ?.customPrompt,
  ).toBe("A prompt");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it("immediate toggles merge latest preferences without submitting either manual draft", async () => {
  await mount();
  await edit(prompt(), "Manual prompt draft");
  await edit(count(), "4");
  persisted = {
    ...persisted,
    language: "ja-JP",
    image_gen: { ...persisted.image_gen, default_count: 3 },
  };
  version++;
  invalidateAppConfigCache();
  const section = [...container.querySelectorAll("section")].find(
    (node) =>
      node.querySelector("h3")?.textContent === "Input Autocomplete Assistant",
  )!;
  await click(section.querySelector<HTMLElement>('[role="switch"]')!);
  expect(writes).toHaveLength(1);
  expect(writes[0].edits.map((edit) => edit.keyPath)).toEqual([
    "workspace_preferences",
  ]);
  expect(persisted.language).toBe("ja-JP");
  expect(persisted.image_gen?.default_count).toBe(3);
  expect(
    persisted.workspace_preferences?.service_models?.topic?.preferredModelId,
  ).toBe("topic");
  expect(
    persisted.workspace_preferences?.service_models?.resource_prompt_rewrite
      ?.customPrompt,
  ).toBe("Saved prompt");
  expect(prompt().value).toBe("Manual prompt draft");
  expect(count().value).toBe("4");
  await edit(prompt(), "Saved prompt");
  await edit(count(), "3");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it("normalizes only the successfully committed image value and preserves a later invalid input", async () => {
  await mount();
  const gate = holdWrite();
  await edit(count(), "9");
  await blur(count());
  expect(count().value).toBe("9");
  await edit(count(), "");
  await act(async () => gate.resolve());
  expect(count().value).toBe("");
  expect(persisted.image_gen?.default_count).toBe(6);
  await edit(count(), "6");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it("slider keyboard commit shares the image draft and confirmed baseline", async () => {
  await mount();
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
  await act(async () => {
    slider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    slider.dispatchEvent(
      new KeyboardEvent("keyup", { key: "End", bubbles: true }),
    );
  });
  expect(persisted.image_gen?.default_count).toBe(6);
  expect(count().value).toBe("6");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it.each(["resolve", "reject"] as const)(
  "ignores late %s after owner unmount without affecting the new draft",
  async (settlement) => {
    await mount();
    const gate = holdWrite();
    await edit(prompt(), "Old owner request");
    await blur(prompt());
    await act(async () => root.render(<p>Replacement owner</p>));
    await mount();
    await edit(prompt(), "New owner draft");
    await act(async () => {
      if (settlement === "resolve") gate.resolve();
      else gate.reject(new Error("private late error"));
    });
    expect(prompt().value).toBe("New owner draft");
    expect(container.textContent).not.toContain("Settings saved");
    expect(container.textContent).not.toContain(
      getLimeI18n().t("settings:settings.mediaServices.message.saveFailed"),
    );
    await click(button("Section"));
    expect(dialog()).not.toBeNull();
    expect(button("Discard changes").disabled).toBe(false);
    expect(writes).toHaveLength(1);
  },
);

it("deduplicates identical image commits before React renders saving state", async () => {
  await mount();
  const update = vi.spyOn(configApi, "updateConfig");
  const gate = holdWrite();
  await edit(count(), "5");
  await act(async () => {
    count().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    count().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => gate.resolve());
  expect(count().value).toBe("5");
  await blur(count());
  expect(update).toHaveBeenCalledTimes(1);
});

it("acknowledges a repeated raw prompt commit after intervening edits without a second write", async () => {
  await mount();
  const gate = holdWrite();
  await edit(prompt(), "  Equivalent pending prompt  ");
  await blur(prompt());
  await edit(prompt(), "Intervening input");
  await edit(prompt(), "  Equivalent pending prompt  ");
  await blur(prompt());
  await act(async () => gate.resolve());
  expect(writes).toHaveLength(1);
  expect(prompt().value).toBe("Equivalent pending prompt");
  await click(button("Section"));
  expect(destination()).not.toBeNull();
});

it("preserves an image count after failure and retries its commit without overwriting other image settings", async () => {
  await mount();
  const gate = holdWrite();
  await edit(count(), "9");
  await blur(count());
  await act(async () =>
    gate.reject(new Error("private count transport error")),
  );
  expect(count().value).toBe("9");
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
  await click(button("Keep editing"));
  await blur(count());
  expect(count().value).toBe("6");
  expect(persisted.image_gen).toEqual({
    default_count: 6,
    default_size: "1024x1024",
  });
  expect(writes).toHaveLength(2);
});

it("keeps a cleared prompt editor until success and preserves typing during its save", async () => {
  await mount();
  const gate = holdWrite();
  await edit(prompt(), "");
  expect(prompt().value).toBe("");
  await blur(prompt());
  await edit(prompt(), "Typed while clearing");
  await act(async () => gate.resolve());
  expect(prompt().value).toBe("Typed while clearing");
  expect(
    persisted.workspace_preferences?.service_models?.resource_prompt_rewrite
      ?.customPrompt,
  ).toBeUndefined();
  await click(button("Section"));
  expect(dialog()).not.toBeNull();
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "%s retains raw drafts and uses the existing translated navigation guard",
  async (locale) => {
    await mount();
    await edit(prompt(), "Locale-independent raw prompt");
    await act(async () => changeLimeLocale(locale));
    await click(button("Search"));
    expect(dialog()?.textContent).toContain(
      getLimeI18n().t("settings:settings.unsavedChanges.discardTitle"),
    );
    expect(dialog()?.textContent).not.toContain("settings.unsavedChanges");
    expect(prompt().value).toBe("Locale-independent raw prompt");
    expect(writes).toHaveLength(0);
  },
);
