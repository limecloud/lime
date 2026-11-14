import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { BrowserExtensionsDialog } from "./BrowserExtensionsDialog";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
  pick: vi.fn(),
  reveal: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("@/lib/api/browserExtensions", () => ({
  listBrowserExtensions: api.list,
  loadBrowserExtension: api.load,
  removeBrowserExtension: api.remove,
  setBrowserExtensionEnabled: api.setEnabled,
}));
vi.mock("@/lib/api/filePicker", () => ({
  pickFilesFromDialog: api.pick,
}));
vi.mock("@/lib/api/fileSystem", () => ({
  revealPathInFinder: api.reveal,
}));

const extension = {
  id: "abc123",
  name: "Fixture Extension",
  version: "1.0.0",
  manifestVersion: 3,
  path: "/tmp/ext",
  enabled: true,
};

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserExtensionsDialog", () => {
  it("打开时加载扩展列表并展示空态", async () => {
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());
    expect(api.list).toHaveBeenCalled();
    expect(document.body.textContent).toContain("暂无扩展");
  });

  it("通过文件夹选择加载扩展并支持移除", async () => {
    api.pick.mockResolvedValue([
      { label: "ext", path: "/tmp/ext", fsPath: "/tmp/ext" },
    ]);
    api.load.mockResolvedValue(extension);
    api.remove.mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());

    api.list.mockResolvedValueOnce([extension]);
    await act(async () => button("加载扩展…").click());
    await act(async () => Promise.resolve());
    expect(api.load).toHaveBeenCalledWith("/tmp/ext");
    expect(document.body.textContent).toContain("Fixture Extension");

    api.list.mockResolvedValueOnce([]);
    await act(async () => button("移除").click());
    await act(async () => Promise.resolve());
    expect(api.remove).toHaveBeenCalledWith("abc123");
    expect(document.body.textContent).toContain("暂无扩展");
  });

  it("按名称或路径过滤扩展", async () => {
    api.list.mockResolvedValue([
      extension,
      {
        id: "ext-2",
        name: "Other Extension",
        version: "2.0.0",
        manifestVersion: 3,
        path: "/tmp/other",
        enabled: true,
      },
    ]);
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "other");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll("li")).toHaveLength(1);
    expect(document.body.textContent).toContain("Other Extension");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "zzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("没有匹配的扩展");
  });

  it("启用/禁用扩展", async () => {
    api.list.mockResolvedValue([extension]);
    api.setEnabled.mockResolvedValue({ ...extension, enabled: false });
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());
    await act(async () => button("禁用").click());
    await act(async () => Promise.resolve());
    expect(api.setEnabled).toHaveBeenCalledWith("abc123", false);
  });

  it("在文件夹中显示扩展目录", async () => {
    api.list.mockResolvedValue([extension]);
    api.reveal.mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());
    await act(async () => button("在文件夹中显示").click());
    expect(api.reveal).toHaveBeenCalledWith("/tmp/ext");
  });

  it("列表加载失败时显示错误", async () => {
    api.list.mockRejectedValueOnce(new Error("boom"));
    await act(async () =>
      root.render(
        <BrowserExtensionsDialog open onOpenChange={() => undefined} />,
      ),
    );
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("无法加载扩展列表");
  });
});
