import { beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createDirectoryAtPath,
  createFileAtPath,
  copyFile,
  deletePath,
  getFileIconDataUrl,
  listDirectory,
  readFilePreview,
  readFileBytes,
  writeFileBytes,
  renamePath,
} from "./fileBrowser";

const {
  appServerCreateDirectoryMock,
  appServerCopyMock,
  appServerGetMetadataMock,
  appServerReadDirectoryMock,
  appServerReadFileMock,
  appServerRemoveMock,
  appServerWriteFileMock,
} = vi.hoisted(() => ({
  appServerCreateDirectoryMock: vi.fn(),
  appServerCopyMock: vi.fn(),
  appServerGetMetadataMock: vi.fn(),
  appServerReadDirectoryMock: vi.fn(),
  appServerReadFileMock: vi.fn(),
  appServerRemoveMock: vi.fn(),
  appServerWriteFileMock: vi.fn(),
}));

vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: vi.fn(function () {
    return {
      createDirectory: appServerCreateDirectoryMock,
      copy: appServerCopyMock,
      getMetadata: appServerGetMetadataMock,
      readDirectory: appServerReadDirectoryMock,
      readFile: appServerReadFileMock,
      remove: appServerRemoveMock,
      writeFile: appServerWriteFileMock,
    };
  }),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("fileBrowser API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("文件副本委托 current fs/copy，不读取或转码内容，并保留失败", async () => {
    appServerCopyMock.mockResolvedValueOnce({ result: {} });
    await copyFile("/work/source.bin", "C:\\exports\\copy.bin");
    expect(appServerCopyMock).toHaveBeenCalledExactlyOnceWith({
      sourcePath: "/work/source.bin",
      destinationPath: "C:\\exports\\copy.bin",
      recursive: false,
    });
    expect(appServerReadFileMock).not.toHaveBeenCalled();
    expect(appServerWriteFileMock).not.toHaveBeenCalled();
    expect(safeInvoke).not.toHaveBeenCalled();
    appServerCopyMock.mockRejectedValueOnce(new Error("copy denied"));
    await expect(copyFile("/work/source.bin", "/copy.bin")).rejects.toThrow(
      "copy denied",
    );
  });

  it("原字节写入使用同一fs/writeFile合同，二进制和多块内容不转码", async () => {
    const bytes = Uint8Array.from({ length: 25000 }, (_, index) => index % 256);
    appServerWriteFileMock.mockResolvedValueOnce({ result: {} });
    await writeFileBytes("C:\\work\\report.xlsx", bytes);
    expect(appServerWriteFileMock).toHaveBeenCalledExactlyOnceWith({
      path: "C:\\work\\report.xlsx",
      dataBase64: Buffer.from(bytes).toString("base64"),
    });
    appServerWriteFileMock.mockRejectedValueOnce(new Error("write denied"));
    await expect(writeFileBytes("/tmp/report.xlsx", bytes)).rejects.toThrow(
      "write denied",
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("应通过 App Server current 主链获取目录列表与文件预览", async () => {
    appServerReadDirectoryMock.mockResolvedValueOnce({
      result: {
        entries: [
          {
            fileName: "Lime.app",
            isDirectory: true,
            isFile: false,
          },
        ],
      },
    });
    appServerGetMetadataMock.mockResolvedValueOnce({
      result: {
        isDirectory: true,
        isFile: false,
        isSymlink: false,
        createdAtMs: 0,
        modifiedAtMs: 1,
      },
    });
    appServerReadFileMock.mockResolvedValueOnce({
      result: { dataBase64: "aGVsbG8=" },
    });

    await expect(listDirectory("/Applications")).resolves.toEqual(
      expect.objectContaining({
        path: "/Applications",
        entries: [
          expect.objectContaining({
            name: "Lime.app",
            path: "/Applications/Lime.app",
            modifiedAt: 1,
          }),
        ],
      }),
    );
    await expect(readFilePreview("/tmp/demo.txt", 1024)).resolves.toEqual(
      expect.objectContaining({ path: "/tmp/demo.txt", content: "hello" }),
    );
    expect(appServerReadDirectoryMock).toHaveBeenCalledWith({
      path: "/Applications",
    });
    expect(appServerGetMetadataMock).toHaveBeenCalledWith({
      path: "/Applications/Lime.app",
    });
    expect(appServerReadFileMock).toHaveBeenCalledWith({
      path: "/tmp/demo.txt",
    });
  });

  it("文件预览应在 renderer 解码、截断文本并识别二进制", async () => {
    appServerReadFileMock
      .mockResolvedValueOnce({ result: { dataBase64: "aGVsbG8=" } })
      .mockResolvedValueOnce({ result: { dataBase64: "AP8=" } });

    await expect(readFilePreview("/tmp/demo.txt", 2)).resolves.toEqual({
      path: "/tmp/demo.txt",
      content: "he",
      isBinary: false,
      size: 5,
      error: null,
    });
    await expect(readFilePreview("/tmp/demo.bin", 1024)).resolves.toEqual({
      path: "/tmp/demo.bin",
      content: null,
      isBinary: true,
      size: 2,
      error: null,
    });
  });

  it.each([
    [1, "a"],
    [2, "a"],
    [3, "a"],
    [4, "a中"],
    [5, "a中"],
    [7, "a中"],
    [8, "a中😀"],
    [9, "a中😀b"],
  ])("有效UTF-8文件在第%d字节截断仍为文本", async (limit, content) => {
    const bytes = Buffer.from("a中😀b", "utf8");
    appServerReadFileMock.mockResolvedValueOnce({
      result: { dataBase64: bytes.toString("base64") },
    });
    await expect(readFilePreview("/tmp/unicode.txt", limit)).resolves.toEqual({
      path: "/tmp/unicode.txt",
      content,
      isBinary: false,
      size: bytes.length,
      error: null,
    });
  });

  it.each([
    [0x61, 0xe4, 0xb8],
    [0x61, 0xff],
    [0x61, 0x00],
  ])("预览之外的坏编码或NUL仍使完整文件归类为binary：%j", async (...values) => {
    const bytes = Buffer.from(values);
    appServerReadFileMock.mockResolvedValueOnce({
      result: { dataBase64: bytes.toString("base64") },
    });
    await expect(readFilePreview("/tmp/binary.dat", 1)).resolves.toMatchObject({
      content: null,
      isBinary: true,
      size: bytes.length,
    });
  });

  it("专业文件原字节保留零字节与非 UTF-8 值，读取拒绝直接失败", async () => {
    appServerReadFileMock
      .mockResolvedValueOnce({ result: { dataBase64: "JVBERgD/" } })
      .mockRejectedValueOnce(new Error("Access denied"));
    await expect(readFileBytes("/tmp/report.pdf")).resolves.toEqual(
      new Uint8Array([37, 80, 68, 70, 0, 255]),
    );
    expect(appServerReadFileMock).toHaveBeenCalledWith({
      path: "/tmp/report.pdf",
    });
    await expect(readFileBytes("/tmp/private.pdf")).rejects.toThrow(
      "Access denied",
    );
  });

  it("应代理文件增删改命令", async () => {
    appServerWriteFileMock.mockResolvedValueOnce({ result: {} });
    appServerCreateDirectoryMock.mockResolvedValueOnce({ result: {} });
    appServerGetMetadataMock.mockResolvedValueOnce({
      result: { isDirectory: false },
    });
    appServerCopyMock.mockResolvedValueOnce({ result: {} });
    appServerRemoveMock.mockResolvedValue({ result: {} });

    await expect(createFileAtPath("/tmp/demo.txt")).resolves.toBeUndefined();
    await expect(
      createDirectoryAtPath("/tmp/demo-dir"),
    ).resolves.toBeUndefined();
    await expect(
      renamePath("/tmp/demo.txt", "/tmp/demo2.txt"),
    ).resolves.toBeUndefined();
    await expect(deletePath("/tmp/demo2.txt", false)).resolves.toBeUndefined();

    expect(appServerWriteFileMock).toHaveBeenCalledWith({
      path: "/tmp/demo.txt",
      dataBase64: "",
    });
    expect(appServerCreateDirectoryMock).toHaveBeenCalledWith({
      path: "/tmp/demo-dir",
      recursive: true,
    });
    expect(appServerGetMetadataMock).toHaveBeenCalledWith({
      path: "/tmp/demo.txt",
    });
    expect(appServerCopyMock).toHaveBeenCalledWith({
      sourcePath: "/tmp/demo.txt",
      destinationPath: "/tmp/demo2.txt",
      recursive: false,
    });
    expect(appServerRemoveMock).toHaveBeenNthCalledWith(1, {
      path: "/tmp/demo.txt",
      recursive: false,
      force: false,
    });
    expect(appServerRemoveMock).toHaveBeenNthCalledWith(2, {
      path: "/tmp/demo2.txt",
      recursive: false,
      force: false,
    });
  });

  it("文件写命令应透传 App Server RPC 错误", async () => {
    const error = new Error("fs/writeFile failed");
    appServerWriteFileMock.mockRejectedValueOnce(error);

    await expect(createFileAtPath("/tmp/demo.txt")).rejects.toThrow(error);
  });

  it("创建目录时应原样传递 Windows 原生路径", async () => {
    appServerCreateDirectoryMock.mockResolvedValueOnce({ result: {} });
    const windowsPath = String.raw`C:\Users\demo\workspace\new-folder`;

    await expect(createDirectoryAtPath(windowsPath)).resolves.toBeUndefined();

    expect(appServerCreateDirectoryMock).toHaveBeenCalledWith({
      path: windowsPath,
      recursive: true,
    });
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

  it("文件图标异步读取允许 null，但错误 payload 应 fail closed", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ error: "failed" });

    await expect(getFileIconDataUrl("/tmp/missing.txt")).resolves.toBeNull();
    await expect(getFileIconDataUrl("/Applications/Lime.app")).rejects.toThrow(
      "get_file_icon_data_url did not return file icon data URL",
    );
    await expect(getFileIconDataUrl("/Applications/Lime.app")).rejects.toThrow(
      "get_file_icon_data_url did not return file icon data URL",
    );
  });
});
