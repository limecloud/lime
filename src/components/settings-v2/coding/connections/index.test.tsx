import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ConnectionsSettings } from ".";

const api = vi.hoisted(() => ({
  grants: vi.fn(),
}));

vi.mock("@/lib/api/connections", () => ({
  listConnectionGrants: api.grants,
}));

let root: Root;
let container: HTMLDivElement;

async function mount() {
  await act(async () => root.render(<ConnectionsSettings />));
  await act(async () => Promise.resolve());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.grants.mockResolvedValue([]);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const grant = {
  id: "icg_original",
  connectionId: "icn_original",
  connectionRevision: 2,
  applicationId: "app_lime",
  applicationName: "Lime",
  actions: ["drive.files.read"],
  fileCount: 2,
  status: "active",
  revision: 1,
  expiresAt: "2026-11-13T08:00:00Z",
};

describe("ConnectionsSettings application grants", () => {
  it("列出当前应用连接、文件数与到期时间", async () => {
    api.grants.mockResolvedValue([grant]);
    await mount();
    const text = container.textContent ?? "";
    expect(api.grants).toHaveBeenCalled();
    expect(text).toContain("应用连接");
    expect(text).toContain("Lime");
    expect(text).toContain("2 个文件");
    expect(text).toContain("有效");
    expect(text).toContain("2026");
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-empty"]',
      ),
    ).toBeNull();
  });

  it("无应用连接时展示空态", async () => {
    await mount();
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-empty"]',
      )?.textContent,
    ).toContain("暂无应用连接");
  });

  it("应用连接加载失败时提示并可按原入口重试", async () => {
    api.grants.mockRejectedValueOnce(new Error("boom"));
    await mount();
    const alert = container.querySelector(
      '[data-testid="settings-connections-grants-error"]',
    )!;
    expect(alert.textContent).toContain("无法读取应用连接");
    api.grants.mockResolvedValue([grant]);
    const retry = [...alert.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重试",
    )!;
    await act(async () => retry.click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Lime");
  });

  it("应用连接加载中显示独立状态", async () => {
    let finish!: (value: unknown[]) => void;
    api.grants.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    const loading = container.querySelector(
      '[data-testid="settings-connections-grants-loading"]',
    );
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-busy")).toBe("true");
    await act(async () => finish([]));
    await act(async () => Promise.resolve());
    expect(
      container.querySelector(
        '[data-testid="settings-connections-grants-loading"]',
      ),
    ).toBeNull();
  });
});
