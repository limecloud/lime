import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { invalidateAppConfigCache } from "@/lib/api/appConfig";
import type { ConfigRequirements } from "@limecloud/app-server-client";
import { BrowserUseSettings } from "./index";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));
let root: Root;
let container: HTMLDivElement;
let persisted: Record<string, unknown>;
let enterprise: ConfigRequirements | null;
let managedOrigins: Record<
  string,
  { name: { type: "mdm"; domain: string; key: string }; version: string }
>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invalidateAppConfigCache();
  window.localStorage.clear();
  persisted = { default_provider: "openai" };
  enterprise = null;
  managedOrigins = {};
  request.mockReset().mockImplementation(async (method) => {
    if (method === "configRequirements/read")
      return { result: { requirements: enterprise } };
    if (method !== "config/read")
      throw new Error(`Unexpected method ${method}`);
    return {
      result: {
        config: structuredClone(persisted),
        origins: managedOrigins,
        layers: [
          {
            name: { type: "user", file: "/fixture/config.yaml" },
            version: "v1",
            config: structuredClone(persisted),
          },
        ],
      },
    };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  invalidateAppConfigCache();
  await changeLimeLocale("zh-CN");
});
async function renderPage() {
  await act(async () => {
    root.render(<BrowserUseSettings />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("locks forced native preferences at the control and event boundaries", async () => {
  await changeLimeLocale("en-US");
  persisted.browser = {
    download_directory: "/managed/downloads",
    annotation_screenshot: "necessary",
    show_full_url: true,
  };
  for (const field of [
    "download_directory",
    "annotation_screenshot",
    "show_full_url",
  ])
    managedOrigins[`browser.${field}`] = {
      name: { type: "mdm", domain: "fixture", key: "config" },
      version: "mdm-v1",
    };
  await renderPage();
  for (const selector of [
    "#browser-download-directory button",
    "#browser-annotation-screenshot button",
    "#browser-full-url button",
  ]) {
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(selector),
    ];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    await act(async () => {
      for (const button of buttons) button.click();
    });
  }
  expect(
    request.mock.calls.every(([method]) => method !== "config/batchWrite"),
  ).toBe(true);
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "shows independent enterprise restrictions and retains saved choices in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    persisted.browser = {
      approvalMode: "neverAsk",
      allowedOrigins: ["private.example.com"],
      webMcpEnabled: true,
      iabHistoryApprovalMode: "neverAsk",
    };
    enterprise = {
      allowedApprovalPolicies: null,
      allowedSandboxModes: null,
      allowedWebSearchModes: null,
      browserUse: {
        allowHistoryAccess: false,
        allowWebmcp: false,
        origins: { "*.example.com": { access: "deny" } },
      },
    };
    await renderPage();
    const saved = container.querySelector<HTMLSelectElement>(
      'select[data-browser-permission-action="browse"][data-browser-permission-pattern="private.example.com"]',
    )!;
    expect(saved.value).toBe("allow");
    expect(saved.disabled).toBe(true);
    expect(saved.dataset.browserPermissionEffective).toBe("deny");
    expect(saved.title.length).toBeGreaterThan(8);
    expect(saved.title).not.toContain("settings.");
    const managed = container.querySelector<HTMLSelectElement>(
      'select[data-browser-permission-action="browse"][data-browser-permission-pattern="*.example.com"]',
    )!;
    expect(managed.disabled).toBe(true);
    expect(managed.dataset.browserPermissionEffective).toBe("deny");
    expect(
      container.querySelector<HTMLButtonElement>(
        "#browser-site-tools button[role=switch]",
      )!.disabled,
    ).toBe(true);
    await act(async () => {
      saved.value = "allow";
      saved.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      request.mock.calls.filter(([method]) => method === "config/batchWrite"),
    ).toHaveLength(0);
    expect(
      (persisted.browser as { allowedOrigins: string[] }).allowedOrigins,
    ).toEqual(["private.example.com"]);
  },
);
