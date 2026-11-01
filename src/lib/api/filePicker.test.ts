import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFilesFromDialog } from "./filePicker";

const { getMetadata } = vi.hoisted(() => ({ getMetadata: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: vi.fn(function () {
    return { getMetadata };
  }),
}));
const openDialog = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  window.electronAPI = {
    invoke: vi.fn(),
    listen: vi.fn(),
    emit: vi.fn(),
    dialog: { open: openDialog, save: vi.fn() },
  };
});
afterEach(() => {
  delete window.electronAPI;
});

describe("current native file picker", () => {
  it("同一真实 bridge 允许混选，目录 descriptor 保留 fsPath 并标记 path", async () => {
    openDialog.mockResolvedValue(["/project/a.txt", "/project/docs"]);
    getMetadata.mockImplementation(async ({ path }: { path: string }) => ({
      result: { isDirectory: path.endsWith("docs") },
    }));
    await expect(pickFilesFromDialog({ title: "选择来源" })).resolves.toEqual([
      { label: "a.txt", path: "/project/a.txt", fsPath: "/project/a.txt" },
      { label: "docs", path: "/project/docs/", fsPath: "/project/docs" },
    ]);
    expect(openDialog).toHaveBeenCalledWith({
      title: "选择来源",
      multiple: true,
      directory: false,
      filesAndDirectories: true,
      filters: undefined,
    });
    expect(getMetadata.mock.calls).toEqual([
      [{ path: "/project/a.txt" }],
      [{ path: "/project/docs" }],
    ]);
  });

  it("Windows 显式目录保留平台分隔符，不启动第二个 metadata 路径", async () => {
    openDialog.mockResolvedValue(["C:\\work\\docs"]);
    await expect(pickFilesFromDialog({ kind: "directory" })).resolves.toEqual([
      { label: "docs", path: "C:\\work\\docs\\", fsPath: "C:\\work\\docs" },
    ]);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("图片过滤及单选只返回文件，不混入目录", async () => {
    openDialog.mockResolvedValue("/project/photo.png");
    await expect(
      pickFilesFromDialog({ imagesOnly: true, allowMultiple: false }),
    ).resolves.toEqual([
      {
        label: "photo.png",
        path: "/project/photo.png",
        fsPath: "/project/photo.png",
      },
    ]);
    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filesAndDirectories: false,
        filters: [
          {
            name: "png, jpg, jpeg, gif, webp",
            extensions: ["png", "jpg", "jpeg", "gif", "webp"],
          },
        ],
      }),
    );
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it.each([null, []])(
    "取消或空选择 %j 不读文件与 metadata",
    async (selected) => {
      openDialog.mockResolvedValue(selected);
      await expect(pickFilesFromDialog()).resolves.toEqual([]);
      expect(getMetadata).not.toHaveBeenCalled();
    },
  );

  it("显式空扩展名列表也保留文件模式，不扩大为目录混选", async () => {
    openDialog.mockResolvedValue(["/project/a.txt"]);
    await pickFilesFromDialog({ acceptedFileExtensions: [] });
    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filesAndDirectories: false,
        filters: undefined,
      }),
    );
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("原生 dialog 和 metadata 失败向同一调用者传播", async () => {
    const error = new Error("picker unavailable");
    openDialog.mockRejectedValueOnce(error);
    await expect(pickFilesFromDialog()).rejects.toBe(error);
    openDialog.mockResolvedValue(["/gone"]);
    getMetadata.mockRejectedValueOnce(error);
    await expect(pickFilesFromDialog()).rejects.toBe(error);
  });

  it.each([[42], [""], {}])("拒绝损坏的 Host 返回值 %j", async (selected) => {
    openDialog.mockResolvedValue(selected);
    await expect(pickFilesFromDialog()).rejects.toThrow("invalid paths");
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("没有 bridge 时 fail closed，不使用测试文件路径兜底", async () => {
    delete window.electronAPI;
    await expect(pickFilesFromDialog()).rejects.toThrow(
      "Native file dialog is unavailable",
    );
    expect(openDialog).not.toHaveBeenCalled();
    expect(getMetadata).not.toHaveBeenCalled();
  });
});
