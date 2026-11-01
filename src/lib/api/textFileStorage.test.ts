import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTextFileStorage } from "./textFileStorage";
const boundary = vi.hoisted(() => ({
  metadata: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("./appServer", () => ({
  AppServerClient: vi.fn(function () {
    return { getMetadata: boundary.metadata };
  }),
}));
vi.mock("./fileBrowser", () => ({
  readFileBytes: boundary.read,
  writeFileBytes: boundary.write,
}));
beforeEach(() => {
  vi.resetAllMocks();
  boundary.metadata.mockResolvedValue({ result: { modifiedAtMs: 3 } });
  boundary.read.mockResolvedValue(new TextEncoder().encode("文\r\n"));
  boundary.write.mockResolvedValue(undefined);
});
describe("text file App Server storage", () => {
  it("通过同一fs边界读完整UTF8；mtime与原文本配对", async () => {
    const storage = createTextFileStorage("C:\\workspace\\file.ts");
    expect(await storage.read(new AbortController().signal)).toEqual({
      content: "文\r\n",
      sizeBytes: 5,
      mtimeMs: 3,
    });
    expect(boundary.read).toHaveBeenCalledWith("C:\\workspace\\file.ts");
    expect(boundary.metadata).toHaveBeenCalledTimes(2);
  });
  it("mtime不匹配返回conflict，绝不调用write", async () => {
    const storage = createTextFileStorage("/work/file");
    expect(
      await storage.write("local", 2, new AbortController().signal),
    ).toEqual({ outcome: "conflict" });
    expect(boundary.write).not.toHaveBeenCalled();
  });
  it("比较后写入再取新mtime，拒绝把序列当原子CAS", async () => {
    boundary.metadata
      .mockResolvedValueOnce({ result: { modifiedAtMs: 3 } })
      .mockResolvedValueOnce({ result: { modifiedAtMs: 4 } });
    expect(
      await createTextFileStorage("/work/file").write(
        "文\r\n",
        3,
        new AbortController().signal,
      ),
    ).toEqual({ outcome: "saved", mtimeMs: 4 });
    expect(boundary.write).toHaveBeenCalledWith(
      "/work/file",
      new TextEncoder().encode("文\r\n"),
    );
    expect(boundary.metadata.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.write.mock.invocationCallOrder[0],
    );
    expect(boundary.write.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.metadata.mock.invocationCallOrder[1],
    );
  });
  it("读取时mtime变化重新读，不把旧内容与新mtime组合", async () => {
    boundary.metadata.mockResolvedValueOnce({ result: { modifiedAtMs: 1 } });
    boundary.read.mockResolvedValueOnce(new TextEncoder().encode("old"));
    expect(
      (
        await createTextFileStorage("/work/file").read(
          new AbortController().signal,
        )
      ).content,
    ).toBe("文\r\n");
    expect(boundary.read).toHaveBeenCalledTimes(2);
  });
  it("abort发生在metadata返回前，不执行后续写入", async () => {
    const abort = new AbortController();
    boundary.metadata.mockImplementationOnce(async () => {
      abort.abort();
      return { result: { modifiedAtMs: 3 } };
    });
    await expect(
      createTextFileStorage("/work/file").write("x", 3, abort.signal),
    ).rejects.toThrow();
    expect(boundary.write).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([0]), new Uint8Array([255])])(
    "二进制或非法UTF8拒绝编辑写回：%j",
    async (bytes) => {
      boundary.read.mockResolvedValue(bytes);
      await expect(
        createTextFileStorage("/work/file").read(new AbortController().signal),
      ).rejects.toThrow();
      expect(boundary.write).not.toHaveBeenCalled();
    },
  );
});
