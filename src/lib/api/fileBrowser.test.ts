import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createDirectoryAtPath,
  createFileAtPath,
  deletePath,
  getFileIconDataUrl,
  getFileManagerLocations,
  listDirectory,
  readFilePreview,
  renamePath,
} from "./fileBrowser";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("fileBrowser API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取目录列表与文件预览", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        path: "~",
        parentPath: null,
        entries: [
          {
            name: "Lime.app",
            path: "/Applications/Lime.app",
            isDir: true,
            size: 0,
            modifiedAt: 1,
            iconDataUrl: "data:image/png;base64,abc",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        path: "/tmp/demo.txt",
        content: "hello",
        isBinary: false,
        size: 5,
        error: null,
      });

    await expect(listDirectory("~")).resolves.toEqual(
      expect.objectContaining({
        path: "~",
        entries: [
          expect.objectContaining({
            name: "Lime.app",
            iconDataUrl: "data:image/png;base64,abc",
          }),
        ],
      }),
    );
    await expect(readFilePreview("/tmp/demo.txt", 1024)).resolves.toEqual(
      expect.objectContaining({ path: "/tmp/demo.txt", content: "hello" }),
    );
  });

  it("应代理文件增删改命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(createFileAtPath("/tmp/demo.txt")).resolves.toBeUndefined();
    await expect(
      createDirectoryAtPath("/tmp/demo-dir"),
    ).resolves.toBeUndefined();
    await expect(
      renamePath("/tmp/demo.txt", "/tmp/demo2.txt"),
    ).resolves.toBeUndefined();
    await expect(deletePath("/tmp/demo2.txt", false)).resolves.toBeUndefined();
  });

  it("应代理文件管理器快捷入口命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        id: "downloads",
        label: "下载",
        path: "/Users/demo/Downloads",
        kind: "downloads",
      },
    ]);

    await expect(getFileManagerLocations()).resolves.toEqual([
      expect.objectContaining({ id: "downloads", label: "下载" }),
    ]);
    expect(safeInvoke).toHaveBeenCalledWith("get_file_manager_locations");
  });

  it("应代理文件图标异步读取命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce("data:image/png;base64,abc");

    await expect(getFileIconDataUrl("/Applications/Lime.app")).resolves.toBe(
      "data:image/png;base64,abc",
    );
    expect(safeInvoke).toHaveBeenCalledWith("get_file_icon_data_url", {
      path: "/Applications/Lime.app",
    });
  });
});
