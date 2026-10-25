import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { SettingsTabs } from "@/types/settings";
import { WorktreeEnvironmentDropdown } from "./WorktreeEnvironmentDropdown";

vi.mock("@/hooks/useLocalEnvironmentSelection", () => ({
  useLocalEnvironmentSelection: vi.fn(),
}));
const workspaceRoot = "/workspace/project";
const configPath = `${workspaceRoot}/.lime/environments/environment.toml`;
const otherPath = `${workspaceRoot}/.lime/environments/environment-2.toml`;
const environment = (path: string, name: string) => ({
  type: "success" as const,
  configPath: path,
  cwdRelativeToGitRoot: ".",
  environment: { name, version: 1, setup: { script: "npm ci" } },
});
const primary = environment(configPath, "Default setup");
const other = environment(otherPath, "Extra setup");
type Selection = ReturnType<typeof useLocalEnvironmentSelection>;
let state: Selection;
let root: Root, container: HTMLDivElement;
let navigate: ReturnType<typeof vi.fn>;
const previousScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

async function render(rootPath = workspaceRoot, disabled = false) {
  await act(async () => {
    root.render(
      <AppNavigationContext.Provider value={navigate}>
        <WorktreeEnvironmentDropdown
          workspaceRoot={rootPath}
          disabled={disabled}
        />
      </AppNavigationContext.Provider>,
    );
  });
}
const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="worktree-environment-trigger"]',
  )!;
const menu = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="worktree-environment-menu"]',
  );
const option = (value: string) =>
  document.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!;
const input = () => menu()!.querySelector<HTMLInputElement>("input")!;
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
};
async function search(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(value: string) {
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });
  vi.clearAllMocks();
  await changeLimeLocale("en-US");
  navigate = vi.fn();
  state = {
    workspaceKey: `local:${workspaceRoot}`,
    environments: [other, primary],
    isLoading: false,
    error: false,
    updating: false,
    ready: true,
    defaultEnvironment: primary,
    defaultEnvironmentNormalized: configPath,
    availableEnvironments: [other],
    resolvedConfigPath: null,
    normalizedResolvedConfigPath: null,
    repairConfigPath: null,
    savedConfigPath: undefined,
    updateSelection: vi.fn().mockResolvedValue(true),
    resetSelection: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
  };
  vi.mocked(useLocalEnvironmentSelection).mockImplementation(() => state);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (previousScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", previousScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  await changeLimeLocale("zh-CN");
});

describe("WorktreeEnvironmentDropdown", () => {
  it("uses the current selection hook without enabling an implicit default, orders and searches successful environments", async () => {
    state.savedConfigPath = otherPath;
    state.resolvedConfigPath = otherPath;
    await render();
    expect(useLocalEnvironmentSelection).toHaveBeenCalledWith({
      workspaceRoot,
      selectDefaultEnvironment: false,
    });
    expect(trigger().textContent).toContain("Extra setup");
    await click(trigger());
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(
      Array.from(menu()!.querySelectorAll("[data-config-path]")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Default setup", "Extra setup"]);
    expect(option(otherPath).getAttribute("aria-current")).toBe("true");
    await search(" EXTRA ");
    expect(option(configPath)).toBeNull();
    expect(option(otherPath)).toBeTruthy();
    await click(option(otherPath));
    expect(state.updateSelection).toHaveBeenCalledExactlyOnceWith(otherPath);
    expect(menu()).toBeNull();
  });

  it("keeps missing, explicit none, and reset as separate actions", async () => {
    await render();
    await click(trigger());
    expect(option("reset-selection")).toBeNull();
    await click(option("no-environment"));
    expect(state.updateSelection).toHaveBeenCalledWith(null);
    state.savedConfigPath = null;
    await render();
    await click(trigger());
    await click(option("reset-selection"));
    expect(state.resetSelection).toHaveBeenCalledExactlyOnceWith();
    expect(menu()).toBeNull();
  });

  it("retains a rejected selection and open menu for a single retry, with no raw error text", async () => {
    state.savedConfigPath = configPath;
    state.resolvedConfigPath = configPath;
    vi.mocked(state.updateSelection)
      .mockRejectedValueOnce(Error("/private/config secret"))
      .mockResolvedValueOnce(true);
    await render();
    await click(trigger());
    await click(option(otherPath));
    expect(trigger().textContent).toContain("Default setup");
    expect(menu()!.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save",
    );
    expect(menu()!.textContent).not.toContain("/private/config");
    await click(option("retry-environments"));
    expect(state.updateSelection).toHaveBeenCalledTimes(2);
    expect(state.updateSelection).toHaveBeenLastCalledWith(otherPath);
    expect(menu()).toBeNull();
  });

  it("shows the applied authority during disk failure and clears the error after the saved notification projection", async () => {
    state.savedConfigPath = configPath;
    state.resolvedConfigPath = configPath;
    vi.mocked(state.updateSelection).mockImplementation(async () => {
      state = {
        ...state,
        error: true,
        savedConfigPath: otherPath,
        resolvedConfigPath: otherPath,
      };
      return false;
    });
    await render();
    await click(trigger());
    await click(option(otherPath));
    await render();
    expect(trigger().textContent).toContain("Extra setup");
    expect(menu()!.querySelector('[role="alert"]')).toBeTruthy();
    state = { ...state, error: false };
    await render();
    expect(menu()!.querySelector('[role="alert"]')).toBeNull();
    expect(trigger().textContent).toContain("Extra setup");
  });

  it("disables selection while loading, retries list errors, and opens a damaged configuration for repair", async () => {
    state = {
      ...state,
      environments: [],
      defaultEnvironment: null,
      availableEnvironments: [],
      isLoading: true,
      ready: false,
    };
    await render();
    await click(trigger());
    expect(menu()!.querySelector('[role="status"]')?.textContent).toContain(
      "Loading environments",
    );
    expect(option("no-environment")).toBeNull();
    state = { ...state, isLoading: false, error: true };
    await render();
    await click(option("retry-environments"));
    expect(state.reload).toHaveBeenCalledExactlyOnceWith();
    state = {
      ...state,
      ready: true,
      error: false,
      repairConfigPath: configPath,
      environments: [
        {
          type: "error",
          configPath,
          cwdRelativeToGitRoot: ".",
          error: { message: "private parse details" },
        },
      ],
    };
    await render();
    expect(menu()!.querySelector('[role="alert"]')?.textContent).toBe(
      "Environment needs attention",
    );
    await click(option("environment-settings"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
      tab: SettingsTabs.LocalEnvironments,
      localEnvironmentFocus: {
        workspaceRoot,
        configPath,
        requestKey: expect.any(Number),
      },
    });
    expect(menu()).toBeNull();
  });

  it("uses Command keyboard navigation and returns focus after Escape", async () => {
    await render();
    await click(trigger());
    await search("Extra");
    await key("Home");
    await key("ArrowDown");
    await key("Enter");
    expect(state.updateSelection).toHaveBeenCalledExactlyOnceWith(otherPath);
    await click(trigger());
    await key("Escape");
    expect(menu()).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("ignores an old workspace mutation receipt after the current workspace changes", async () => {
    let resolve!: (value: boolean) => void;
    vi.mocked(state.updateSelection).mockReturnValueOnce(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    await render();
    await click(trigger());
    await click(option(otherPath));
    await click(option(otherPath));
    expect(state.updateSelection).toHaveBeenCalledTimes(1);
    await render("/workspace/replacement");
    await click(trigger());
    await act(async () => resolve(false));
    expect(menu()).toBeTruthy();
    expect(menu()!.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes a live picker when disabled and prevents hidden selection writes", async () => {
    await render();
    await click(trigger());
    expect(menu()).toBeTruthy();
    await render(workspaceRoot, true);
    expect(trigger().disabled).toBe(true);
    expect(menu()).toBeNull();
    await click(trigger());
    expect(menu()).toBeNull();
    expect(state.updateSelection).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "renders %s menu labels and settings navigation without raw keys",
    async (locale) => {
      await changeLimeLocale(locale);
      await render();
      await click(trigger());
      expect(menu()!.textContent).not.toMatch(
        /composer\.worktreeEnvironment|codex\.environmentSelector/,
      );
      expect(input().getAttribute("aria-label")?.length).toBeGreaterThan(0);
      await click(option("environment-settings"));
      expect(navigate).toHaveBeenCalledWith("settings", {
        tab: SettingsTabs.LocalEnvironments,
        localEnvironmentFocus: {
          workspaceRoot,
          requestKey: expect.any(Number),
        },
      });
    },
  );
});
