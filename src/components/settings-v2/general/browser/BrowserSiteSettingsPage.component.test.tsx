import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { BrowserSiteSettingsSnapshot } from "@/lib/api/browserSiteSettingsTypes";
import { DEFAULT_BROWSER_SITE_SETTINGS } from "@/lib/api/browserSiteSettingsTypes";
import { BrowserSiteSettingsPage } from "./BrowserSiteSettingsPage";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api/browserSiteSettings", () => ({
  getBrowserSiteSettings: api.get,
  updateBrowserSiteSetting: api.update,
  removeBrowserSiteSettings: api.remove,
}));
vi.mock("./BrowserManagementHeader", () => ({
  BrowserManagementHeader: ({
    title,
    onBack,
  }: {
    title: string;
    onBack: () => void;
  }) => (
    <header>
      <h1>{title}</h1>
      <button type="button" onClick={onBack}>
        Back
      </button>
    </header>
  ),
}));

const empty = (): BrowserSiteSettingsSnapshot => ({
  revision: 0,
  defaults: { ...DEFAULT_BROWSER_SITE_SETTINGS },
  sites: [],
});
let container: HTMLDivElement;
let root: Root;
const back = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  api.get.mockReset().mockResolvedValue(empty());
  api.update.mockReset().mockImplementation(async (value) => {
    const state = empty();
    const origin = value.origin ?? "https://example.com";
    state.sites = [
      {
        origin,
        camera: null,
        microphone: null,
        geolocation: null,
        notifications: null,
        clipboard: null,
        sound: null,
        protectedContent: null,
        automaticDownloads: null,
        images: null,
      },
    ];
    state.revision = 1;
    if (value.origin === null) state.defaults[value.permission] = value.setting;
    return state;
  });
  api.remove.mockReset().mockResolvedValue(empty());
  back.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("BrowserSiteSettingsPage", () => {
  it.each([
    ["zh-CN", "网站设置", "剪贴板", "声音", "受保护内容 ID", "自动多文件下载"],
    [
      "zh-TW",
      "網站設定",
      "剪貼簿",
      "音效",
      "受保護的內容 ID",
      "自動下載多個檔案",
    ],
    [
      "en-US",
      "Site settings",
      "Clipboard",
      "Sound",
      "Protected content IDs",
      "Automatic downloads",
    ],
    [
      "ja-JP",
      "サイト設定",
      "クリップボード",
      "音声",
      "保護されたコンテンツ ID",
      "複数ファイルの自動ダウンロード",
    ],
    [
      "ko-KR",
      "사이트 설정",
      "클립보드",
      "소리",
      "보호된 콘텐츠 ID",
      "여러 파일 자동 다운로드",
    ],
  ] as const)(
    "renders the site settings page in %s",
    async (
      locale,
      title,
      clipboard,
      sound,
      protectedContent,
      automaticDownloads,
    ) => {
      await changeLimeLocale(locale);
      await act(async () =>
        root.render(<BrowserSiteSettingsPage onBack={back} />),
      );
      expect(container.querySelector("h1")?.textContent).toBe(title);
      const images = container.querySelector<HTMLSelectElement>(
        "#browser-site-default-images select",
      )!;
      expect(images.getAttribute("aria-label")).toBe(
        {
          "zh-CN": "图片",
          "zh-TW": "圖片",
          "en-US": "Images",
          "ja-JP": "画像",
          "ko-KR": "이미지",
        }[locale],
      );
      expect(Array.from(images.options, (option) => option.value)).toEqual([
        "allow",
        "block",
      ]);
      expect(
        container.querySelector(`select[aria-label="${clipboard}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector(`select[aria-label="${sound}"]`),
      ).not.toBeNull();
      for (const label of [protectedContent, automaticDownloads]) {
        const select = container.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`,
        )!;
        expect(select).not.toBeNull();
        expect(select.disabled).toBe(label === protectedContent);
        expect(Array.from(select.options, (option) => option.value)).toEqual([
          "ask",
          "allow",
          "block",
        ]);
      }
    },
  );

  it("persists the default image setting through the current gateway", async () => {
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    const images = container.querySelector<HTMLSelectElement>(
      "#browser-site-default-images select",
    )!;
    await act(async () => {
      images.value = "block";
      images.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.update).toHaveBeenCalledExactlyOnceWith({
      origin: null,
      permission: "images",
      setting: "block",
    });
    expect(images.value).toBe("block");
  });

  it("does not send writes for the unavailable protected-content control", async () => {
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    const control = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Protected content IDs"]',
    )!;
    expect(control.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Protected content IDs are unavailable in this version.",
    );
    await act(async () => {
      control.value = "allow";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.update).not.toHaveBeenCalled();
  });

  it("loads defaults, adds a canonical site and removes its entry", async () => {
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    expect(container.querySelector("h1")?.textContent).toBe("Site settings");
    expect(container.querySelector('[aria-label="Camera"]')).not.toBeNull();

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Add a website"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "https://example.com/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(api.update).toHaveBeenCalledWith({
      origin: "https://example.com",
      permission: "camera",
      setting: null,
    });
    expect(container.textContent).toContain("https://example.com");

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Remove")!
        .click();
    });
    expect(api.remove).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects paths and credentials before the Host call", async () => {
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Add a website"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "https://example.com/private");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a valid HTTP or HTTPS website origin",
    );
    expect(api.update).not.toHaveBeenCalled();
  });

  it("saves an explicit ask separately from inheritance and offers location and notification controls", async () => {
    const state = empty();
    state.defaults.camera = "allow";
    state.sites = [
      {
        origin: "https://example.com",
        camera: "block",
        microphone: null,
        geolocation: null,
        notifications: null,
        clipboard: null,
        sound: null,
        protectedContent: null,
        automaticDownloads: null,
        images: null,
      },
    ];
    api.get.mockResolvedValue(state);
    api.update.mockResolvedValue(state);
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    expect(container.querySelectorAll('[aria-label="Location"]')).toHaveLength(
      2,
    );
    expect(
      container.querySelectorAll('[aria-label="Notifications"]'),
    ).toHaveLength(2);
    const camera = container.querySelectorAll<HTMLSelectElement>(
      'select[aria-label="Camera"]',
    )[1];
    const select = async (value: string) =>
      act(async () => {
        camera.value = value;
        camera.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await select("ask");
    expect(api.update).toHaveBeenLastCalledWith({
      origin: "https://example.com",
      permission: "camera",
      setting: "ask",
    });
    await select("default");
    expect(api.update).toHaveBeenLastCalledWith({
      origin: "https://example.com",
      permission: "camera",
      setting: null,
    });
  });

  it("saves clipboard prompting and sound blocking with distinct valid choices", async () => {
    await act(async () =>
      root.render(<BrowserSiteSettingsPage onBack={back} />),
    );
    const clipboard = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Clipboard"]',
    )!;
    const sound = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Sound"]',
    )!;
    expect([...clipboard.options].map((option) => option.value)).toEqual([
      "ask",
      "allow",
      "block",
    ]);
    expect([...sound.options].map((option) => option.value)).toEqual([
      "allow",
      "block",
    ]);
    expect(sound.value).toBe("allow");
    await act(async () => {
      sound.value = "block";
      sound.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.update).toHaveBeenLastCalledWith({
      origin: null,
      permission: "sound",
      setting: "block",
    });
    await act(async () => {
      clipboard.value = "allow";
      clipboard.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.update).toHaveBeenLastCalledWith({
      origin: null,
      permission: "clipboard",
      setting: "allow",
    });
    const siteSound = container.querySelectorAll<HTMLSelectElement>(
      'select[aria-label="Sound"]',
    )[1];
    expect([...siteSound.options].map((option) => option.value)).toEqual([
      "default",
      "allow",
      "block",
    ]);
  });
});
