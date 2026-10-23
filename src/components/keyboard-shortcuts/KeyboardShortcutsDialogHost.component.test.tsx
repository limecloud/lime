import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, AppShellContent } from "@/components/app-shell/AppShell";
import { SidebarProfileFooter } from "@/components/app-sidebar/SidebarProfileFooter";
import { SettingsSidebar } from "@/components/settings-v2/_layout/SettingsSidebar";
import { changeLimeLocale } from "@/i18n/createI18n";
import { getRegisteredCommands } from "@/lib/commands/registry";
import { SettingsTabs } from "@/types/settings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/commands/preferences", () => ({
  observeCommandBindings: () => () => {},
}));
vi.mock("@/lib/cloudAccount", () => ({
  getCloudAccount: () => null,
  subscribeCloudAccount: () => () => {},
  getOemCloudBootstrapSnapshot: () => null,
  logoutCloudAccount: vi.fn(),
}));

let root: Root;
beforeEach(async () => {
  await changeLimeLocale("en-US");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

function surface(settings: boolean) {
  return (
    <StrictMode>
      <AppShell>
        {settings ? (
          <SettingsSidebar
            activeTab={SettingsTabs.Developer}
            onTabChange={vi.fn()}
          />
        ) : (
          <SidebarProfileFooter onNavigate={vi.fn()} />
        )}
        <AppShellContent pageSurface>
          {settings ? "Settings" : "Thread"}
        </AppShellContent>
      </AppShell>
    </StrictMode>
  );
}

async function toggle(target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await import("./KeyboardShortcutsDialog");
  });
  // Radix 将关闭后的焦点恢复排入下一轮 timer，恢复输入也会触发真实 onFocus。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function expectOpen() {
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll("[data-keyboard-shortcuts-dialog]"),
    ).toHaveLength(1),
  );
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Search shortcuts"]',
  )!;
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  return input;
}

async function close() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector("[data-keyboard-shortcuts-dialog]"),
    ).toBeNull(),
  );
}

describe("AppShell KeyboardShortcutsDialogHost", () => {
  it("再次打开后搜索框刚获焦时的 Escape 也关闭同一 Dialog", async () => {
    act(() => root.render(surface(false)));
    const account = document.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-account-button"]',
    )!;
    act(() => account.focus());
    await toggle(account);
    const firstInput = await expectOpen();
    await act(async () => {
      firstInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-keyboard-shortcuts-dialog]"),
      ).toBeNull(),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(account));
    const escapeOnFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        target.closest("[data-keyboard-shortcuts-dialog]")
      ) {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    document.addEventListener("focusin", escapeOnFocus);
    try {
      await toggle(account);
      await vi.waitFor(() =>
        expect(
          document.querySelector("[data-keyboard-shortcuts-dialog]"),
        ).toBeNull(),
      );
      await vi.waitFor(() => expect(document.activeElement).toBe(account));
    } finally {
      document.removeEventListener("focusin", escapeOnFocus);
    }
  });

  it("Sidebar 与 Settings 之间切换始终只有一个全局 Mod+/，恢复当前输入焦点", async () => {
    act(() => root.render(surface(false)));
    const account = document.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-account-button"]',
    )!;
    act(() => account.focus());
    await toggle(account);
    await expectOpen();
    await close();
    await vi.waitFor(() => expect(document.activeElement).toBe(account));

    act(() => root.render(surface(true)));
    expect(
      getRegisteredCommands().filter(
        ({ id }) => id === "showKeyboardShortcuts",
      ),
    ).toHaveLength(1);
    const search = document.querySelector<HTMLInputElement>(
      '[data-testid="settings-sidebar-search"]',
    )!;
    act(() => search.focus());
    await toggle(search);
    const dialogInput = await expectOpen();
    expect(
      document.querySelector('[data-command-id="searchSettings"]'),
    ).not.toBeNull();
    await toggle(dialogInput);
    await vi.waitFor(() => expect(document.activeElement).toBe(search));

    act(() => root.render(surface(false)));
    await toggle();
    await expectOpen();
    expect(
      document.querySelector('[data-command-id="searchSettings"]'),
    ).toBeNull();
  });

  it("Dialog 打开时卸载 Footer 仍保留 Dialog，关闭回到当前主内容", async () => {
    act(() => root.render(surface(false)));
    const account = document.querySelector<HTMLButtonElement>(
      '[data-testid="app-sidebar-account-button"]',
    )!;
    act(() => account.focus());
    await toggle(account);
    const input = await expectOpen();
    act(() => root.render(surface(true)));
    expect(account.isConnected).toBe(false);
    expect(document.querySelector('[aria-label="Search shortcuts"]')).toBe(
      input,
    );
    expect(document.activeElement).toBe(input);
    await close();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector("[data-app-shell-content]"),
      ),
    );
  });

  it("卸载 AppShell 撤销 handler 和按键，重新挂载不残留重复 Dialog", async () => {
    act(() => root.render(surface(true)));
    await toggle();
    await expectOpen();
    await act(async () => root.render(null));
    expect(getRegisteredCommands()).toEqual([]);
    const event = new KeyboardEvent("keydown", {
      key: "/",
      ctrlKey: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(
      document.querySelector("[data-keyboard-shortcuts-dialog]"),
    ).toBeNull();
    act(() => root.render(surface(true)));
    await toggle();
    await expectOpen();
  });
});
