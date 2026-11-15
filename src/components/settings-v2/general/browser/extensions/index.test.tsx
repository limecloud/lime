import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { BrowserExtensionSettings } from ".";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  importChrome: vi.fn(),
}));
vi.mock("@/lib/api/browserExtensions", () => ({
  listBrowserExtensions: api.list,
  loadBrowserExtension: api.load,
  removeBrowserExtension: api.remove,
  setBrowserExtensionEnabled: api.setEnabled,
  importChromeBrowserExtensions: api.importChrome,
}));
vi.mock("@/lib/api/filePicker", () => ({ pickFilesFromDialog: vi.fn() }));
vi.mock("@/lib/api/fileSystem", () => ({ revealPathInFinder: vi.fn() }));

const extension = {
  id: "ext-1",
  name: "Lime Helper",
  version: "1.2.3",
  manifestVersion: 3,
  path: "/tmp/ext",
  enabled: true,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.list.mockResolvedValue([extension]);
  api.setEnabled.mockResolvedValue(undefined);
  api.importChrome.mockResolvedValue({ imported: 2, skipped: 1, failed: 1 });
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<BrowserExtensionSettings />));
  await act(async () => Promise.resolve());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserExtensionSettings", () => {
  it("列出扩展并支持禁用", async () => {
    expect(container.textContent).toContain("Lime Helper");
    expect(container.textContent).toContain("v1.2.3");
    const disable = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "禁用",
    )!;
    await act(async () => disable.click());
    await act(async () => Promise.resolve());
    expect(api.setEnabled).toHaveBeenCalledWith("ext-1", false);
  });

  it("从 Chrome 导入扩展并显示结果", async () => {
    const importButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "从 Chrome 导入",
    )!;
    await act(async () => importButton.click());
    await act(async () => Promise.resolve());
    const confirm = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find(
      (button) => button.textContent?.trim() === "从 Chrome 导入",
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    await act(async () => Promise.resolve());
    expect(api.importChrome).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "已从 Chrome 导入 2 个扩展，跳过 1 个，1 个失败",
    );
  });

  it("空列表显示空态", async () => {
    api.list.mockResolvedValue([]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<BrowserExtensionSettings />));
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("暂无扩展");
  });
});
