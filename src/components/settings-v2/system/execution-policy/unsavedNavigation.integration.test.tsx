import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import type { Config, ConfigUpdater } from "@/lib/api/appConfig";
import { SettingsTabs } from "@/types/settings";
import { SettingsNavigationGuard } from "../../_layout/SettingsNavigationGuard";
import { ExecutionPolicySettings } from ".";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
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
    () => handleNavigate("settings", { tab: SettingsTabs.ExecutionPolicy }),
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
      navigation.requestedPageParams?.tab === SettingsTabs.ExecutionPolicy ? (
        <SettingsNavigationGuard navigationGuard={navigation.navigationGuard}>
          <ExecutionPolicySettings />
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
function button(text: string) {
  const node = [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!node) throw new Error("Missing button " + text);
  return node;
}
function input() {
  const node = container.querySelector('[data-testid="shell-rule-0"] input');
  if (!(node instanceof HTMLInputElement))
    throw new Error("Missing rule input");
  return node;
}
async function edit(value: string) {
  await act(async () => {
    const node = input();
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
    agent: {
      default_model: "test-model",
      workspace_sandbox: {
        enabled: true,
        strict: false,
        notify_on_fallback: true,
      },
      tool_execution: {
        tool_overrides: { Bash: { warning_policy: "none" } },
        shell_command_rules: [
          { rule_id: "initial", pattern: "echo", match_type: "prefix" },
        ],
        network_rules: [
          { rule_id: "network", target: "host", pattern: "example.test" },
        ],
      },
    },
  } as Config;
  api.getConfig.mockResolvedValue(initial);
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
  "%s protects the actual policy form without persisting",
  async (target) => {
    await mount();
    await edit("changed");
    await click(button(target));
    expect(dialog()).not.toBeNull();
    expect(input().value).toBe("changed");
    await click(button("Keep editing"));
    expect(dialog()).toBeNull();
    expect(input().value).toBe("changed");
    await click(button(target));
    await click(button("Discard changes"));
    expect(
      container.querySelector('[data-testid="destination"]'),
    ).not.toBeNull();
    expect(api.saveConfig).not.toHaveBeenCalled();
  },
);

it("preserves later config and unedited policy fields on save", async () => {
  await mount();
  await edit("changed");
  const current = {
    ...initial,
    language: "ja-JP",
    agent: {
      ...initial.agent,
      default_model: "later-model",
      temperature: 0.3,
      workspace_sandbox: {
        enabled: false,
        strict: true,
        notify_on_fallback: false,
      },
      tool_execution: {
        ...initial.agent!.tool_execution,
        update_plan_enabled: true,
        tool_overrides: {
          bash: { warning_policy: "shell_command_risk" as const },
          read: { warning_policy: "none" as const },
        },
        network_rules: [{ rule_id: "later-network", pattern: "later.test" }],
      },
    },
  };
  api.getConfig.mockResolvedValue(current);
  await click(button("Save policy"));
  expect(api.saveConfig).toHaveBeenCalledWith({
    ...current,
    agent: {
      ...current.agent,
      tool_execution: {
        ...current.agent.tool_execution,
        shell_command_rules: [
          {
            rule_id: "changed",
            pattern: "echo",
            match_type: "prefix",
            risk_level: "medium",
            reason_code: "",
            reason: "",
          },
        ],
      },
    },
  });
  expect(button("Save policy").disabled).toBe(true);
  await click(button("Section"));
  expect(dialog()).toBeNull();
});

it("rejects duplicate save and saving discard, preserving subsequent same-field edits", async () => {
  await mount();
  await edit("submitted");
  const pending = deferred<void>();
  api.saveConfig.mockReturnValueOnce(pending.promise);
  await act(async () => {
    button("Save policy").click();
    button("Save policy").click();
  });
  expect(api.saveConfig).toHaveBeenCalledTimes(1);
  await edit("later");
  await click(button("Section"));
  expect(button("Discard changes").disabled).toBe(true);
  await act(async () => navigation.navigationGuard.discardPendingNavigation());
  expect(input().value).toBe("later");
  await click(button("Keep editing"));
  await act(async () => pending.resolve());
  expect(input().value).toBe("later");
  expect(dialog()).toBeNull();
  expect(container.querySelector('[data-testid="destination"]')).toBeNull();
  await click(button("Save policy"));
  expect(api.saveConfig).toHaveBeenCalledTimes(2);
  expect(
    api.saveConfig.mock.calls[1][0].agent.tool_execution.shell_command_rules[0]
      .rule_id,
  ).toBe("later");
});

it("accepts submitted fields while retaining a different in-flight field", async () => {
  await mount();
  await edit("submitted");
  const pending = deferred<void>();
  api.saveConfig.mockReturnValueOnce(pending.promise);
  await click(button("Save policy"));
  await click(
    container.querySelector(
      'button[aria-label="Enable the update_plan planning tool"]',
    )!,
  );
  await act(async () => pending.resolve());
  expect(input().value).toBe("submitted");
  expect(button("Save policy").disabled).toBe(false);
  await click(
    container.querySelector(
      'button[aria-label="Enable the update_plan planning tool"]',
    )!,
  );
  expect(button("Save policy").disabled).toBe(true);
});

it("keeps failed drafts, hides backend values and allows save retry", async () => {
  await mount();
  await edit("changed");
  api.saveConfig.mockRejectedValueOnce(new Error("private policy value"));
  await click(button("Save policy"));
  expect(input().value).toBe("changed");
  expect(container.textContent).toContain("Failed to save execution policy");
  expect(container.textContent).not.toContain("private policy value");
  expect(button("Reload").disabled).toBe(true);
  await click(button("Save policy"));
  expect(api.saveConfig).toHaveBeenCalledTimes(2);
});

it("disables editing after load failure and permits retry", async () => {
  api.getConfig.mockRejectedValueOnce(new Error("private load value"));
  await mount();
  expect(button("Save policy").disabled).toBe(true);
  expect(container.textContent).toContain("Failed to load execution policy");
  expect(container.textContent).not.toContain("private load value");
  expect(container.querySelector('[role="switch"]')?.matches(":disabled")).toBe(
    true,
  );
  await click(button("Reload"));
  expect(input().value).toBe("initial");
});

it("only reloads pristine drafts and keeps dirty rule input and focus", async () => {
  await mount();
  expect(button("Save policy").disabled).toBe(true);
  await click(button("Reload"));
  expect(api.getConfig).toHaveBeenCalledTimes(2);
  const node = input();
  node.focus();
  await edit("renamed");
  expect(input()).toBe(node);
  expect(document.activeElement).toBe(node);
  expect(button("Reload").disabled).toBe(true);
  await click(button("Reload"));
  expect(api.getConfig).toHaveBeenCalledTimes(2);
  expect(input().value).toBe("renamed");
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s translates existing drafts without rereading or losing input",
  async (locale) => {
    await mount();
    await edit("unsaved");
    await act(async () => {
      await changeLimeLocale(locale);
    });
    expect(input().value).toBe("unsaved");
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    const save = getLimeI18n().t("settings.executionPolicy.action.save", {
      ns: "settings",
    });
    expect(button(save).disabled).toBe(false);
  },
);

it.each(["load", "save"])(
  "ignores a late %s response after leaving the owner",
  async (kind) => {
    const pending = deferred<Config>();
    if (kind === "load") api.getConfig.mockReturnValueOnce(pending.promise);
    await mount();
    if (kind === "save") {
      await edit("submitted");
      api.saveConfig.mockReturnValueOnce(pending.promise);
      await click(button("Save policy"));
    }
    await act(async () => root.render(<p>replacement owner</p>));
    await act(async () => pending.resolve(initial));
    expect(container.textContent).toBe("replacement owner");
    expect(dialog()).toBeNull();
  },
);
