import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import type { McpServer } from "@/lib/api/mcp";
import type { SettingsPageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { SettingsNavigationGuard } from "../settings-v2/_layout/SettingsNavigationGuard";
import { McpPage } from "./McpPage";

const api = vi.hoisted(() => ({
  addServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  refresh: vi.fn(),
}));
const servers: McpServer[] = ["alpha", "beta"].map((name) => ({
  id: name,
  name,
  description: `${name} description`,
  server_config: { command: "node", args: [`${name}.js`] },
  enabled_lime: true,
  enabled_claude: false,
  enabled_codex: true,
  enabled_gemini: false,
  created_at: 1,
}));
vi.mock("@/hooks/useMcpServers", () => ({
  useMcpServers: () => ({
    ...api,
    servers,
    loading: false,
    importing: false,
    error: null,
    importFromApp: vi.fn(),
    importFromAllApps: vi.fn(),
    syncAllToLive: vi.fn(),
  }),
}));
let navigation: ReturnType<typeof useAppNavigation>;
function Harness() {
  navigation = useAppNavigation();
  const { handleNavigate } = navigation;
  useLayoutEffect(
    () => handleNavigate("settings", { tab: SettingsTabs.McpServer }),
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
            tab: SettingsTabs.LocalEnvironments,
            searchFocus: {
              targetId: "local-environments-projects",
              requestKey: 1,
            },
          })
        }
      >
        Search result
      </button>
      {navigation.requestedPage === "settings" &&
      (navigation.requestedPageParams as SettingsPageParams)?.tab ===
        SettingsTabs.McpServer ? (
        <SettingsNavigationGuard navigationGuard={navigation.navigationGuard}>
          <McpPage hideHeader />
        </SettingsNavigationGuard>
      ) : (
        <p data-testid="destination">{navigation.requestedPage}</p>
      )}
    </>
  );
}
let root: Root;
let container: HTMLDivElement;
function element<T extends HTMLElement = HTMLElement>(id: string) {
  const node = container.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`Missing element ${id}`);
  return node;
}
function button(text: string) {
  const node = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button ${text}`);
  return node;
}
function server(name: string) {
  const node = [
    ...container.querySelectorAll<HTMLElement>(
      '[data-testid="mcp-config-server"]',
    ),
  ].find((candidate) => candidate.textContent?.includes(name));
  if (!node) throw new Error(`Missing server ${name}`);
  return node;
}
const click = async (node: HTMLElement) => act(async () => node.click());
const dialog = () =>
  document.querySelector('[data-testid="settings-unsaved-changes-dialog"]');
const nameInput = () => element<HTMLInputElement>("mcp-config-name");
async function edit(value: string, id = "mcp-config-name") {
  await act(async () => {
    const node = element<HTMLInputElement | HTMLTextAreaElement>(id);
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  await act(async () => root.render(<Harness />));
  await click(server("alpha"));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  vi.resetAllMocks();
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
  for (const fn of Object.values(api)) fn.mockResolvedValue(undefined);
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  await changeLimeLocale("zh-CN");
});

it.each(["Section", "Back", "Home", "Root", "New", "Search result"])(
  "%s protects the actual MCP draft without persisting",
  async (target) => {
    await mount();
    await edit("unsaved alpha");
    await click(button(target));
    expect(dialog()).not.toBeNull();
    expect(nameInput().value).toBe("unsaved alpha");
    await click(button("Keep editing"));
    expect(dialog()).toBeNull();
    await click(button(target));
    await click(button("Discard changes"));
    expect(
      container.querySelector('[data-testid="destination"]'),
    ).not.toBeNull();
    expect(api.addServer).not.toHaveBeenCalled();
    expect(api.updateServer).not.toHaveBeenCalled();
    expect(api.deleteServer).not.toHaveBeenCalled();
  },
);

it.each(["server", "create", "cancel"])(
  "guards internal %s changes and keeps raw JSON and focus",
  async (target) => {
    await mount();
    await edit("{ ", "mcp-config-json");
    const original = element<HTMLTextAreaElement>("mcp-config-json");
    original.focus();
    original.setSelectionRange(1, 2);
    const targetNode =
      target === "server"
        ? server("beta")
        : element(
            `mcp-config-${target === "create" ? "create-server" : "cancel"}`,
          );
    await click(targetNode);
    expect(dialog()).not.toBeNull();
    expect(element("mcp-config-json")).toBe(original);
    await click(button("Keep editing"));
    await vi.waitFor(() => expect(document.activeElement).toBe(original));
    expect(original.value).toBe("{ ");
    expect(original.selectionStart).toBe(1);
    expect(original.selectionEnd).toBe(2);
    await click(targetNode);
    await click(button("Discard changes"));
    expect(dialog()).toBeNull();
    if (target === "server") expect(nameInput().value).toBe("beta");
    else if (target === "create") expect(nameInput().value).toBe("");
    else
      expect(
        container.querySelector('[data-testid="mcp-config-name"]'),
      ).toBeNull();
    expect(api.updateServer).not.toHaveBeenCalled();
  },
);

it("does not reload a draft when reselecting its server or refreshing the list", async () => {
  await mount();
  await edit("alpha draft");
  await click(server("alpha"));
  await click(
    container.querySelector<HTMLButtonElement>('button[title="Refresh"]')!,
  );
  expect(api.refresh).toHaveBeenCalledTimes(1);
  expect(nameInput().value).toBe("alpha draft");
  expect(dialog()).toBeNull();
  await click(button("Root"));
  expect(dialog()).not.toBeNull();
});

it("accepts normalized saved fields and unregisters clean drafts", async () => {
  await mount();
  await edit("  saved alpha  ");
  await click(element("mcp-config-save"));
  expect(api.updateServer).toHaveBeenCalledWith(
    expect.objectContaining({ id: "alpha", name: "saved alpha" }),
  );
  expect(nameInput().value).toBe("saved alpha");
  await click(button("Root"));
  expect(dialog()).toBeNull();
  expect(container.querySelector('[data-testid="destination"]')).not.toBeNull();
});

it("locks duplicate saves and edits, then keeps the pending destination explicit", async () => {
  await mount();
  await edit("saved alpha");
  const pending = deferred();
  api.updateServer.mockReturnValueOnce(pending.promise);
  await act(async () => {
    element("mcp-config-save").click();
    element("mcp-config-save").click();
  });
  expect(api.updateServer).toHaveBeenCalledTimes(1);
  expect(nameInput().matches(":disabled")).toBe(true);
  await edit("must not replace saving draft");
  await click(server("beta"));
  expect(dialog()).not.toBeNull();
  expect(button("Discard changes").disabled).toBe(true);
  await click(button("Discard changes"));
  expect(nameInput().value).toBe("saved alpha");
  await act(async () => pending.resolve());
  expect(nameInput().value).toBe("saved alpha");
  await click(button("Discard changes"));
  expect(nameInput().value).toBe("beta");
  expect(api.deleteServer).not.toHaveBeenCalled();
});

it("blocks root discard while saving and keeps failed drafts available for retry", async () => {
  await mount();
  await edit("retry alpha");
  const pending = deferred();
  api.updateServer.mockReturnValueOnce(pending.promise);
  await click(element("mcp-config-save"));
  await click(button("Root"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => navigation.navigationGuard.discardPendingNavigation());
  expect(nameInput().value).toBe("retry alpha");
  await click(button("Keep editing"));
  await act(async () => pending.reject(new Error("save failed")));
  expect(nameInput().value).toBe("retry alpha");
  await click(element("mcp-config-save"));
  expect(api.updateServer).toHaveBeenCalledTimes(2);
  await click(button("Root"));
  expect(dialog()).toBeNull();
});

it.each([
  ["save", "resolve"],
  ["save", "reject"],
  ["delete", "resolve"],
  ["delete", "reject"],
] as const)(
  "ignores late %s %s after the owner is unmounted",
  async (operation, outcome) => {
    await mount();
    await edit("old alpha");
    const pending = deferred();
    if (operation === "save") {
      api.updateServer.mockReturnValueOnce(pending.promise);
      await click(element("mcp-config-save"));
    } else {
      api.deleteServer.mockReturnValueOnce(pending.promise);
      await click(element("mcp-config-delete"));
      await click(
        document.querySelector<HTMLElement>(
          '[data-testid="confirm-dialog-confirm"]',
        )!,
      );
    }
    await act(async () =>
      root.render(<McpPage key="replacement" hideHeader />),
    );
    await click(server("beta"));
    await edit("new beta");
    await act(async () =>
      outcome === "resolve"
        ? pending.resolve()
        : pending.reject(new Error("late failure")),
    );
    expect(nameInput().value).toBe("new beta");
    expect(window.alert).not.toHaveBeenCalled();
  },
);

it("locks duplicate creates and preserves the requested cancel until saving finishes", async () => {
  await mount();
  await click(element("mcp-config-create-server"));
  await click(element("mcp-config-preset-context7"));
  const pending = deferred();
  api.addServer.mockReturnValueOnce(pending.promise);
  await act(async () => {
    element("mcp-config-save").click();
    element("mcp-config-save").click();
  });
  expect(api.addServer).toHaveBeenCalledTimes(1);
  await click(element("mcp-config-cancel"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => pending.resolve());
  await click(button("Discard changes"));
  expect(container.querySelector('[data-testid="mcp-config-name"]')).toBeNull();
  await click(button("Root"));
  expect(dialog()).toBeNull();
});

it("locks duplicate deletion and prevents abandoning the owner while deleting", async () => {
  await mount();
  await edit("alpha draft");
  const pending = deferred();
  api.deleteServer.mockReturnValueOnce(pending.promise);
  await click(element("mcp-config-delete"));
  const confirm = document.querySelector<HTMLElement>(
    '[data-testid="confirm-dialog-confirm"]',
  )!;
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  expect(api.deleteServer).toHaveBeenCalledExactlyOnceWith("alpha");
  await click(button("Root"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => pending.resolve());
  await click(button("Discard changes"));
  expect(container.querySelector('[data-testid="destination"]')).not.toBeNull();
});

it("marks preset changes dirty while an untouched new form remains clean", async () => {
  await mount();
  await click(element("mcp-config-create-server"));
  await click(element("mcp-config-cancel"));
  expect(dialog()).toBeNull();
  await click(element("mcp-config-create-server"));
  await click(element("mcp-config-preset-context7"));
  await click(element("mcp-config-cancel"));
  expect(dialog()).not.toBeNull();
  await click(button("Keep editing"));
  expect(nameInput().value).toBe("Context7");
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "%s reuses the translated guard without replacing the draft",
  async (locale) => {
    await mount();
    await edit("alpha draft");
    await act(async () => changeLimeLocale(locale));
    await click(server("beta"));
    const translate = (key: string) =>
      getLimeI18n().t(`settings:settings.unsavedChanges.${key}`);
    expect(dialog()?.textContent).toContain(translate("discardTitle"));
    await click(button(translate("keepEditing")));
    expect(nameInput().value).toBe("alpha draft");
    api.deleteServer.mockRejectedValueOnce(
      new Error("private deletion marker"),
    );
    await click(element("mcp-config-delete"));
    await click(
      document.querySelector<HTMLElement>(
        '[data-testid="confirm-dialog-confirm"]',
      )!,
    );
    expect(window.alert).toHaveBeenCalledWith(
      getLimeI18n().t("settings:settings.mcpPage.toast.deleteFailed"),
    );
    expect(window.alert).not.toHaveBeenCalledWith(
      expect.stringContaining("private deletion marker"),
    );
    expect(nameInput().value).toBe("alpha draft");
  },
);
