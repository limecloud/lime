import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { getRegisteredCommands } from "@/lib/commands/registry";
import { PRODUCT_LINKS } from "@/lib/productLinks";
import { SidebarProfileFooter } from "./SidebarProfileFooter";
import { AppShell } from "@/components/app-shell/AppShell";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: mocks.openExternal,
}));
vi.mock("@/lib/cloudAccount", () => ({
  getCloudAccount: () => null,
  subscribeCloudAccount: () => () => {},
  logoutCloudAccount: vi.fn(),
  startCloudAuthorization: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));

let root: Root;
let previousI18nLanguage: string;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.openExternal.mockResolvedValue(undefined);
  previousI18nLanguage = getLimeI18n().language;
  await changeLimeLocale("zh-CN");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <AppShell>
        <SidebarProfileFooter onNavigate={vi.fn()} />
      </AppShell>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  await changeLimeLocale(previousI18nLanguage);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
}
async function openHelp() {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-testid="app-sidebar-account-button"]',
  )!;
  await act(async () => {
    button.focus();
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  const t = getLimeI18n().getFixedT(null, "navigation");
  const help = await vi.waitFor(() => {
    const item = menuItem(t("help.title"));
    expect(item).toBeDefined();
    return item!;
  });
  await act(async () => {
    help.focus();
    help.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  await vi.waitFor(() => expect(menuItem(t("help.userGuide"))).toBeDefined());
  return { button, t };
}

describe("Profile Help", () => {
  it("submenu 按父菜单底部定位，父菜单尺寸变化后重新对齐", async () => {
    let parentHeight = 300;
    const size = (element: HTMLElement): [number, number] => {
      if (element.hasAttribute("data-radix-popper-content-wrapper")) {
        const child = element.firstElementChild;
        return child instanceof HTMLElement ? size(child) : [0, 0];
      }
      if (element.getAttribute("data-testid") === "app-sidebar-account-menu")
        return [256, parentHeight];
      if (element.getAttribute("role") === "menu") return [224, 98];
      return [36, 30];
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        const [width, height] = size(this);
        if (this.getAttribute("data-testid") === "app-sidebar-account-menu")
          return new DOMRect(52, 120, width, height);
        if (
          this.getAttribute("aria-haspopup") === "menu" &&
          this.textContent === "帮助"
        )
          return new DOMRect(56, 300, 248, 30);
        return new DOMRect(0, 0, width, height);
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function () {
        return size(this)[0];
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function () {
        return size(this)[1];
      },
    );
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      1024,
    );
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
      768,
    );
    await openHelp();
    const guide = menuItem("使用指南")!;
    const submenu = guide.closest('[role="menu"]')!;
    const floating = submenu.parentElement!;
    await vi.waitFor(() =>
      expect(floating.style.transform).toContain(", 322px)"),
    );
    parentHeight = 360;
    await act(async () => window.dispatchEvent(new Event("resize")));
    await vi.waitFor(() =>
      expect(floating.style.transform).toContain(", 382px)"),
    );
  });

  it("Help 外链沿唯一 current gateway 使用 Lime links，失败可见", async () => {
    const { t } = await openHelp();
    await act(async () => menuItem(t("help.whatsNew"))!.click());
    expect(mocks.openExternal).toHaveBeenLastCalledWith(PRODUCT_LINKS.releases);
    await openHelp();
    mocks.openExternal.mockRejectedValueOnce(new Error("browser unavailable"));
    await act(async () => menuItem(t("help.userGuide"))!.click());
    expect(mocks.openExternal).toHaveBeenLastCalledWith(
      PRODUCT_LINKS.userGuide,
    );
    expect(mocks.error).toHaveBeenCalledWith(t("help.openLinkFailed"));
  });

  it("Help 和 Mod+/ 使用同一 showKeyboardShortcuts，关闭恢复账号触发器", async () => {
    const { button, t } = await openHelp();
    await act(async () => {
      menuItem(t("help.keyboardShortcuts"))!.click();
      await import("@/components/keyboard-shortcuts/KeyboardShortcutsDialog");
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-command-id="showKeyboardShortcuts"]'),
    ).not.toBeNull();
    await act(async () => {
      document.querySelector<HTMLInputElement>("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
    await act(async () => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${t("help.close")}"]`,
        )!
        .click(),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("卸载 Footer 保留全局命令，卸载 AppShell 才移除命令与按键", () => {
    expect(
      getRegisteredCommands().some(
        (command) => command.id === "showKeyboardShortcuts",
      ),
    ).toBe(true);
    act(() => root.render(<AppShell>{null}</AppShell>));
    expect(
      getRegisteredCommands().some(
        (command) => command.id === "showKeyboardShortcuts",
      ),
    ).toBe(true);
    act(() => root.render(null));
    expect(getRegisteredCommands()).toEqual([]);
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 提供三个可访问 Help 入口",
    async (locale) => {
      await act(async () => {
        await changeLimeLocale(locale);
      });
      const { t } = await openHelp();
      for (const key of [
        "help.whatsNew",
        "help.userGuide",
        "help.keyboardShortcuts",
      ]) {
        expect(menuItem(t(key))).toBeDefined();
        expect(t(key)).not.toBe(key);
      }
    },
  );
});
