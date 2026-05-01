import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileManagerSidebar } from "./FileManagerSidebar";
import {
  getFileIconDataUrl,
  getFileManagerLocations,
  listDirectory,
  type DirectoryListing,
} from "@/lib/api/fileBrowser";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";

const APP_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  getFileIconDataUrl: vi.fn(),
  getFileManagerLocations: vi.fn(),
  listDirectory: vi.fn(),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  openPathWithDefaultApp: vi.fn(),
  revealPathInFinder: vi.fn(),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createListing(path: string): DirectoryListing {
  if (path === "/Applications") {
    return {
      path,
      parentPath: null,
      entries: [
        {
          name: "Lime.app",
          path: "/Applications/Lime.app",
          isDir: true,
          size: 0,
          modifiedAt: Date.now(),
        },
      ],
      error: null,
    };
  }
  return {
    path,
    parentPath: path === "/Users/demo" ? null : "/Users/demo",
    entries: [
      {
        name: "Downloads",
        path: "/Users/demo/Downloads",
        isDir: true,
        size: 0,
        modifiedAt: Date.now(),
      },
      {
        name: "brief.txt",
        path: "/Users/demo/brief.txt",
        isDir: false,
        size: 128,
        modifiedAt: Date.now(),
        mimeType: "text/plain",
      },
    ],
    error: null,
  };
}

async function renderFileManagerSidebar(props?: {
  onClose?: () => void;
  onAddPathReferences?: React.ComponentProps<
    typeof FileManagerSidebar
  >["onAddPathReferences"];
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = props?.onClose ?? vi.fn();
  const onAddPathReferences = props?.onAddPathReferences ?? vi.fn();

  await act(async () => {
    root.render(
      <FileManagerSidebar
        onClose={onClose}
        onAddPathReferences={onAddPathReferences}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  mountedRoots.push({ root, container });
  return { container, onClose, onAddPathReferences };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(getFileManagerLocations).mockResolvedValue([
    {
      id: "home",
      label: "个人",
      path: "/Users/demo",
      kind: "home",
    },
    {
      id: "downloads",
      label: "下载",
      path: "/Users/demo/Downloads",
      kind: "downloads",
    },
    {
      id: "applications",
      label: "应用程序",
      path: "/Applications",
      kind: "applications",
    },
  ]);
  vi.mocked(listDirectory).mockImplementation(async (path: string) =>
    createListing(path),
  );
  vi.mocked(getFileIconDataUrl).mockImplementation(async (path: string) =>
    path === "/Users/demo/Downloads" || path === "/Applications/Lime.app"
      ? APP_ICON_DATA_URL
      : null,
  );
  vi.mocked(openPathWithDefaultApp).mockResolvedValue(undefined);
  vi.mocked(revealPathInFinder).mockResolvedValue(undefined);
  window.localStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("FileManagerSidebar", () => {
  it("图标读取很慢时也应先完成目录加载", async () => {
    vi.mocked(getFileIconDataUrl).mockImplementation(
      () => new Promise<string | null>(() => undefined),
    );

    const { container } = await renderFileManagerSidebar();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listDirectory).toHaveBeenCalledWith("/Users/demo");
    expect(container.textContent).toContain("Downloads");
    expect(container.textContent).not.toContain("加载中");
    expect(
      container.querySelector('[data-testid="file-manager-entry-native-icon"]'),
    ).toBeNull();
    expect(getFileIconDataUrl).toHaveBeenCalled();
  });

  it("应加载系统位置与目录条目，并保留安全右键菜单", async () => {
    const onAddPathReferences = vi.fn();
    const { container } = await renderFileManagerSidebar({
      onAddPathReferences,
    });

    expect(getFileManagerLocations).toHaveBeenCalled();
    expect(listDirectory).toHaveBeenCalledWith("/Users/demo");
    expect(container.textContent).toContain("个人");
    expect(container.textContent).toContain("Downloads");

    const downloadsEntry = Array.from(
      container.querySelectorAll('[data-testid="file-manager-entry"]'),
    ).find((entry) => entry.textContent?.includes("Downloads"));
    expect(downloadsEntry).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      (
        downloadsEntry?.querySelector(
          '[data-testid="file-manager-entry-native-icon"]',
        ) as HTMLImageElement | null
      )?.getAttribute("src"),
    ).toBe(APP_ICON_DATA_URL);

    await act(async () => {
      downloadsEntry?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 24,
          clientY: 32,
        }),
      );
      await Promise.resolve();
    });

    const menu = document.querySelector(
      '[data-testid="file-manager-context-menu"]',
    );
    expect(menu?.textContent).toContain("添加到对话");
    expect(menu?.textContent).toContain("在系统文件管理器中显示");
    expect(menu?.textContent).not.toContain("删除");
    expect(menu?.textContent).not.toContain("重命名");

    const addAction = Array.from(menu?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("添加到对话"),
    );
    expect(addAction).toBeTruthy();

    await act(async () => {
      addAction?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onAddPathReferences).toHaveBeenCalledWith([
      expect.objectContaining({
        path: "/Users/demo/Downloads",
        name: "Downloads",
        isDir: true,
        source: "file_manager",
      }),
    ]);
  });

  it("应支持关闭侧栏", async () => {
    const onClose = vi.fn();
    const { container } = await renderFileManagerSidebar({ onClose });

    const closeButton = container.querySelector(
      'button[aria-label="关闭文件管理器"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("应用程序位置应渲染原生应用图标，侧栏保持窄轨", async () => {
    const { container } = await renderFileManagerSidebar();
    const sidebar = container.querySelector(
      '[data-testid="file-manager-sidebar"]',
    ) as HTMLElement | null;
    const rail = container.querySelector(
      '[data-testid="file-manager-location-rail"]',
    ) as HTMLDivElement | null;
    const applicationsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.getAttribute("aria-label") === "应用程序");

    expect(sidebar?.className).toContain("w-[312px]");
    expect(rail?.className).toContain("w-[48px]");
    expect(applicationsButton).toBeTruthy();

    await act(async () => {
      applicationsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const appEntry = container.querySelector(
      '[data-testid="file-manager-entry"][data-file-path="/Applications/Lime.app"]',
    ) as HTMLButtonElement | null;

    expect(appEntry).toBeTruthy();
    expect(appEntry?.dataset.entryKind).toBe("application");
    expect(
      appEntry
        ?.querySelector('[data-testid="file-manager-entry-icon"]')
        ?.getAttribute("data-icon-kind"),
    ).toBe("application");
    expect(
      appEntry
        ?.querySelector('[data-testid="file-manager-entry-icon"]')
        ?.getAttribute("data-icon-source"),
    ).toBe("native");
    expect(
      (
        appEntry?.querySelector(
          '[data-testid="file-manager-entry-native-icon"]',
        ) as HTMLImageElement | null
      )?.getAttribute("src"),
    ).toBe(APP_ICON_DATA_URL);
  });
});
