import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createDirectoryAtPath,
  createFileAtPath,
  deletePath,
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
        entries: [],
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
      expect.objectContaining({ path: "~" }),
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
});
