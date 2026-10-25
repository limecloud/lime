import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  browserWindowCtorMock,
  browserWindowGetAllWindowsMock,
  focusWindowMock,
  getFileIconMock,
  getPathMock,
  loadUrlMock,
  openPathMock,
  showItemInFolderMock,
  showWindowMock,
} = vi.hoisted(() => {
  const loadUrlMock = vi.fn();
  const showWindowMock = vi.fn();
  const focusWindowMock = vi.fn();
  const browserWindowCtorMock = vi.fn(() => ({
    focus: focusWindowMock,
    isDestroyed: () => false,
    loadURL: loadUrlMock,
    off: vi.fn(),
    on: vi.fn(),
    once: vi.fn((event: string, callback: () => void) => {
      if (event === "ready-to-show") {
        callback();
      }
    }),
    show: showWindowMock,
    webContents: {
      getURL: () => "",
    },
  }));
  const browserWindowGetAllWindowsMock = vi.fn((): MockBrowserWindow[] => []);
  return {
    browserWindowCtorMock,
    browserWindowGetAllWindowsMock,
    focusWindowMock,
    getFileIconMock: vi.fn(),
    getPathMock: vi.fn((_name: string) => os.tmpdir()),
    loadUrlMock,
    openPathMock: vi.fn(),
    showItemInFolderMock: vi.fn(),
    showWindowMock,
  };
});

vi.mock("./electronRuntime", () => ({
  app: {
    getFileIcon: getFileIconMock,
    getPath: getPathMock,
  },
  BrowserWindow: Object.assign(browserWindowCtorMock, {
    getAllWindows: browserWindowGetAllWindowsMock,
  }),
  shell: {
    openPath: openPathMock,
    showItemInFolder: showItemInFolderMock,
  },
}));

import { FileShellHost } from "./fileShellHost";

type MockBrowserWindow = {
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  webContents: {
    getURL: () => string;
  };
};

const tempDirs: string[] = [];

async function createTempUserDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lime-file-shell-host-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.clearAllMocks();
  browserWindowGetAllWindowsMock.mockReturnValue([]);
  getPathMock.mockImplementation(() => os.tmpdir());
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("FileShellHost", () => {
  it("revealInFinder 通过 Electron shell 定位本地文件", async () => {
    const directory = await createTempUserDataDir();
    const targetFile = path.join(directory, "demo.txt");
    await writeFile(targetFile, "local file");
    const host = new FileShellHost();

    await expect(host.revealInFinder({ path: targetFile })).resolves.toEqual(
      {},
    );

    expect(showItemInFolderMock).toHaveBeenCalledWith(targetFile);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("revealInFinder 应直接打开目录，避免 Windows 无法跳转安装目录", async () => {
    openPathMock.mockResolvedValueOnce("");
    const targetDirectory = await createTempUserDataDir();
    const host = new FileShellHost();

    await expect(
      host.revealInFinder({ path: targetDirectory }),
    ).resolves.toEqual({});

    expect(openPathMock).toHaveBeenCalledWith(targetDirectory);
    expect(showItemInFolderMock).not.toHaveBeenCalled();
  });

  it("revealInFinder 应暴露目录打开失败", async () => {
    openPathMock.mockResolvedValueOnce("Unable to open directory");
    const targetDirectory = await createTempUserDataDir();
    const host = new FileShellHost();

    await expect(
      host.revealInFinder({ path: targetDirectory }),
    ).rejects.toThrow("Unable to open directory");
  });

  it("不存在的工作区路径交给原生打开并暴露错误，不能假定位成功", async () => {
    const directory = await createTempUserDataDir();
    const missingPath = path.join(directory, "missing");
    openPathMock.mockResolvedValueOnce("Path does not exist");
    const host = new FileShellHost();

    await expect(host.revealInFinder({ path: missingPath })).rejects.toThrow(
      "Path does not exist",
    );
    expect(openPathMock).toHaveBeenCalledWith(missingPath);
    expect(showItemInFolderMock).not.toHaveBeenCalled();
  });

  it("open systemDefault 在 Windows 通过 Electron shell 打开本地路径", async () => {
    openPathMock.mockResolvedValueOnce("");
    const host = new FileShellHost({
      platform: "win32",
      appDataRoot: await createTempUserDataDir(),
    });

    await expect(
      host.open({ path: "/tmp/demo.txt", target: "systemDefault" }),
    ).resolves.toEqual({});

    expect(openPathMock).toHaveBeenCalledWith("/tmp/demo.txt");
  });

  it("open systemDefault 应暴露 Electron openPath 失败", async () => {
    openPathMock.mockResolvedValueOnce("Cannot open file");
    const host = new FileShellHost({
      platform: "win32",
      appDataRoot: await createTempUserDataDir(),
    });

    await expect(
      host.open({ path: "/tmp/missing.txt", target: "systemDefault" }),
    ).rejects.toThrow("Cannot open file");
  });

  it("openFilePreviewWindow 通过 Electron BrowserWindow 打开本地文件 URL", async () => {
    const userDataDir = await createTempUserDataDir();
    const host = new FileShellHost();
    const targetPath = path.join(userDataDir, "prototype.html");

    await expect(
      host.openFilePreviewWindow({
        path: targetPath,
        title: "Prototype",
      }),
    ).resolves.toEqual({
      opened: true,
      reused: false,
      url: expect.stringMatching(/^file:\/\//),
      title: "Prototype",
    });

    const expectedUrl = pathToFileURL(targetPath).toString();
    expect(loadUrlMock).toHaveBeenCalledWith(expectedUrl);
    expect(browserWindowCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1280,
        minWidth: 860,
        title: "Prototype",
        show: false,
      }),
    );
    expect(showWindowMock).toHaveBeenCalledTimes(1);
    expect(focusWindowMock).toHaveBeenCalledTimes(1);
  });

  it("openFilePreviewWindow 已存在同 URL 窗口时复用并聚焦", async () => {
    const userDataDir = await createTempUserDataDir();
    const host = new FileShellHost();
    const targetPath = path.join(userDataDir, "prototype.html");
    const expectedUrl = pathToFileURL(targetPath).toString();
    const existingWindow = {
      focus: focusWindowMock,
      show: showWindowMock,
      webContents: {
        getURL: () => expectedUrl,
      },
    };
    browserWindowGetAllWindowsMock.mockReturnValueOnce([existingWindow]);

    await expect(
      host.openFilePreviewWindow({ path: targetPath }),
    ).resolves.toEqual({
      opened: true,
      reused: true,
      url: expectedUrl,
      title: "prototype.html",
    });

    expect(browserWindowCtorMock).not.toHaveBeenCalled();
    expect(loadUrlMock).not.toHaveBeenCalled();
    expect(showWindowMock).toHaveBeenCalledTimes(1);
    expect(focusWindowMock).toHaveBeenCalledTimes(1);
  });

  it("openFilePreviewWindow 拒绝相对路径", async () => {
    const host = new FileShellHost();

    await expect(
      host.openFilePreviewWindow({
        path: "relative/prototype.html",
      }),
    ).rejects.toThrow("path 必须是绝对路径");
  });

  it("getFileIconDataUrl 应通过 Electron 读取系统文件图标", async () => {
    getFileIconMock.mockResolvedValueOnce({
      isEmpty: () => false,
      toDataURL: () => "data:image/png;base64,abc",
    });
    const host = new FileShellHost();

    await expect(
      host.getFileIconDataUrl({ path: "/Applications/Lime.app" }),
    ).resolves.toBe("data:image/png;base64,abc");

    expect(getFileIconMock).toHaveBeenCalledWith("/Applications/Lime.app", {
      size: "normal",
    });
  });

  it("系统图标读取跨 Host 串行化，原生失败后继续处理下一个请求", async () => {
    let rejectFirst!: (error: Error) => void;
    let markFirstReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markFirstReady = resolve;
    });
    getFileIconMock.mockImplementationOnce(() => {
      markFirstReady();
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    getFileIconMock.mockResolvedValueOnce({
      isEmpty: () => false,
      toDataURL: () => "data:image/png;base64,next",
    });
    const first = new FileShellHost({ platform: "darwin" }).getFileIconDataUrl({
      path: "/Applications/First.app",
    });
    const next = new FileShellHost({ platform: "darwin" }).getFileIconDataUrl({
      path: "/Applications/Next.app",
    });
    await ready;
    expect(getFileIconMock).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("native icon unavailable"));
    await expect(first).resolves.toBeNull();
    await expect(next).resolves.toBe("data:image/png;base64,next");
    expect(getFileIconMock.mock.calls).toEqual([
      ["/Applications/First.app", { size: "normal" }],
      ["/Applications/Next.app", { size: "normal" }],
    ]);
  });

  it("getFileIconDataUrl 在系统图标不可用时返回 null", async () => {
    getFileIconMock.mockResolvedValueOnce({
      isEmpty: () => true,
      toDataURL: () => "data:image/png;base64,unused",
    });
    const host = new FileShellHost();

    await expect(
      host.getFileIconDataUrl({ path: "/tmp/missing.txt" }),
    ).resolves.toBeNull();
  });

  it("getFileIconDataUrl 应隔离 Electron 图标读取失败", async () => {
    getFileIconMock.mockRejectedValueOnce(new Error("icon unavailable"));
    const host = new FileShellHost();

    await expect(
      host.getFileIconDataUrl({ path: "/tmp/missing.txt" }),
    ).resolves.toBeNull();
  });

  it("getHomeDir 应返回 Electron 系统主目录", async () => {
    const userDataDir = await createTempUserDataDir();
    const homeDir = path.join(userDataDir, "home");
    getPathMock.mockImplementation((name: string) => {
      return name === "home" ? homeDir : os.tmpdir();
    });
    const host = new FileShellHost();

    expect(host.getHomeDir()).toBe(homeDir);
  });

  it("getHomeDir 在系统主目录不可用时应 fail closed", () => {
    getPathMock.mockImplementation((name: string) => {
      return name === "home" ? "" : os.tmpdir();
    });
    const host = new FileShellHost();

    expect(() => host.getHomeDir()).toThrow("无法获取主目录");
  });
});
