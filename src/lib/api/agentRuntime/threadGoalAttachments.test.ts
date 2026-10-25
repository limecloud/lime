import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializeThreadGoal,
  ThreadGoalAttachmentStore,
  type ThreadGoalDraft,
} from "./threadGoalAttachments";

const id = "650b212f-cdd5-4378-b5a3-57673cdb9401";
const directory = `/isolated/app-server/attachments/${id}`;
const text = (value: Uint8Array) => new TextDecoder().decode(value);
function harness() {
  const written = new Map<string, Uint8Array>();
  const files = {
    read: vi.fn(async (_path: string) => new Uint8Array([1, 2, 3])),
    write: vi.fn(async (path: string, contents: Uint8Array) => {
      written.set(path, contents);
    }),
    createDirectory: vi.fn(async (_path: string) => undefined),
    remove: vi.fn(async (_path: string) => undefined),
  };
  return {
    files,
    written,
    options: {
      files,
      getAgentRoot: () => "/isolated/app-server",
      createId: () => id,
    },
  };
}
const draft = (input: Partial<ThreadGoalDraft> = {}): ThreadGoalDraft => ({
  objective: "goal",
  pastedTextAttachments: [],
  imageAttachments: [],
  ...input,
});

afterEach(() => vi.restoreAllMocks());

describe("ThreadGoal attachment materialization", () => {
  it("Unicode codepoint 4000 正文不需要 Desktop root，4001 转目标文件且保留全文", async () => {
    const h = harness();
    const direct = await materializeThreadGoal(
      draft({ objective: "😀".repeat(4000) }),
      { ...h.options, getAgentRoot: () => undefined },
    );
    expect(direct.objective).toBe("😀".repeat(4000));
    expect(h.files.createDirectory).not.toHaveBeenCalled();
    const long = "😀".repeat(4001);
    const materialized = await materializeThreadGoal(
      draft({ objective: long }),
      h.options,
    );
    expect(materialized.objective).toBe(
      `Read the Lime goal objective file at ${directory}/goal-objective.md before continuing.`,
    );
    expect(text(h.written.get(`${directory}/goal-objective.md`)!)).toBe(long);
    expect(h.files.remove).not.toHaveBeenCalled();
  });

  it("空正文、空附件拒绝，单独粘贴文本有效", async () => {
    const h = harness();
    await expect(
      materializeThreadGoal(draft({ objective: " " }), h.options),
    ).rejects.toThrow("required");
    const result = await materializeThreadGoal(
      draft({
        objective: "",
        pastedTextAttachments: [{ text: "中😀\nsource" }],
      }),
      h.options,
    );
    expect(result.objective).toBe(
      `Referenced pasted text files:\n- pasted text file: ${directory}/pasted-text-1.txt. Read this file before continuing.`,
    );
    expect(text(h.written.get(`${directory}/pasted-text-1.txt`)!)).toBe(
      "中😀\nsource",
    );
  });

  it("仅 URL 图片不下载、不创建目录，也不要求 Desktop root", async () => {
    const h = harness();
    const result = await materializeThreadGoal(
      draft({
        objective: "",
        imageAttachments: [{ src: "https://example.test/image.png?x=1" }],
      }),
      { ...h.options, getAgentRoot: () => undefined },
    );
    expect(result.objective).toBe(
      "Referenced image URLs:\n- [Image #1]: https://example.test/image.png?x=1",
    );
    expect(h.files.read).not.toHaveBeenCalled();
    expect(h.files.createDirectory).not.toHaveBeenCalled();
    await result.cleanup();
    expect(h.files.remove).not.toHaveBeenCalled();
  });

  it("混合图片保留原位置编号，MIME/文件扩展名和节顺序匹配参考", async () => {
    const h = harness();
    const result = await materializeThreadGoal(
      draft({
        objective: "  inspect  ",
        pastedTextAttachments: [{ text: "paste" }],
        imageAttachments: [
          { src: "https://example.test/a" },
          { src: "data:image/jpeg;base64,AQID" },
          { src: "file:///tmp/a%20b.WEBP", filename: "a.WEBP" },
          { src: "data:image/svg+xml;charset=utf-8,%E4%B8%AD" },
        ],
      }),
      h.options,
    );
    expect(result.objective).toBe(
      [
        "inspect",
        `Referenced pasted text files:\n- pasted text file: ${directory}/pasted-text-1.txt. Read this file before continuing.`,
        `Referenced image files:\n- [Image #2]: ${directory}/image-2.jpg\n- [Image #3]: ${directory}/image-3.webp\n- [Image #4]: ${directory}/image-4.svgxml`,
        "Referenced image URLs:\n- [Image #1]: https://example.test/a",
      ].join("\n\n"),
    );
    expect(h.files.createDirectory).toHaveBeenCalledExactlyOnceWith(directory);
    expect(h.files.read).toHaveBeenCalledExactlyOnceWith("/tmp/a b.WEBP");
    expect([...h.written.get(`${directory}/image-2.jpg`)!]).toEqual([1, 2, 3]);
    expect(text(h.written.get(`${directory}/image-4.svgxml`)!)).toBe("中");
    expect(h.files.read.mock.invocationCallOrder[0]).toBeLessThan(
      h.files.createDirectory.mock.invocationCallOrder[0],
    );
    expect(h.files.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["file:///C:/Users/test/a%20b.png", "C:\\Users\\test\\a b.png"],
    ["file://server/share/a%20b.png", "\\\\server\\share\\a b.png"],
  ])("本地图片 %s 使用平台文件路径", async (src, expected) => {
    const h = harness();
    await materializeThreadGoal(
      draft({ imageAttachments: [{ src }] }),
      h.options,
    );
    expect(h.files.read).toHaveBeenCalledWith(expected);
  });

  it("读图失败前不产生任何目录或写入", async () => {
    const h = harness();
    h.files.read.mockRejectedValueOnce(new Error("source missing"));
    await expect(
      materializeThreadGoal(
        draft({
          pastedTextAttachments: [{ text: "paste" }],
          imageAttachments: [{ src: "/source.png" }],
        }),
        h.options,
      ),
    ).rejects.toThrow("source missing");
    expect(h.files.createDirectory).not.toHaveBeenCalled();
    expect(h.files.write).not.toHaveBeenCalled();
    expect(h.files.remove).not.toHaveBeenCalled();
  });

  it("部分写入失败只回收本次 owned 目录，原始文件保留", async () => {
    const h = harness();
    h.files.write
      .mockImplementationOnce(async (path, contents) => {
        h.written.set(path, contents);
      })
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(
      materializeThreadGoal(
        draft({
          pastedTextAttachments: [{ text: "one" }, { text: "two" }],
          imageAttachments: [{ src: "/source.png" }],
        }),
        h.options,
      ),
    ).rejects.toThrow("write failed");
    expect(h.files.remove).toHaveBeenCalledExactlyOnceWith(directory);
  });

  it("准备失效时回收已创建目录，未发出后续写入", async () => {
    const h = harness();
    let current = true;
    h.files.createDirectory.mockImplementationOnce(async () => {
      current = false;
    });
    await expect(
      materializeThreadGoal(
        draft({ pastedTextAttachments: [{ text: "one" }] }),
        {
          ...h.options,
          assertRequestCurrent: () => {
            if (!current) throw new Error("superseded");
          },
        },
      ),
    ).rejects.toThrow("superseded");
    expect(h.files.write).not.toHaveBeenCalled();
    expect(h.files.remove).toHaveBeenCalledExactlyOnceWith(directory);
  });

  it("清理失败不遮原始错误", async () => {
    const h = harness();
    const diagnostic = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    h.files.write.mockRejectedValueOnce(new Error("original write error"));
    h.files.remove.mockRejectedValueOnce(new Error("remove failed"));
    await expect(
      materializeThreadGoal(
        draft({ pastedTextAttachments: [{ text: "paste" }] }),
        h.options,
      ),
    ).rejects.toThrow("original write error");
    expect(diagnostic).toHaveBeenCalledWith(
      "[ThreadGoal] attachment cleanup failed",
    );
  });

  it("缺少 Main root 时需要落盘的目标 fail closed", async () => {
    const h = harness();
    await expect(
      materializeThreadGoal(
        draft({ imageAttachments: [{ src: "data:image/png;base64,AQID" }] }),
        { ...h.options, getAgentRoot: () => undefined },
      ),
    ).rejects.toThrow("root is unavailable");
    expect(h.files.createDirectory).not.toHaveBeenCalled();
    expect(h.files.write).not.toHaveBeenCalled();
  });

  it("过长的文件引用在写入前拒绝，清除本次目标目录", async () => {
    const h = harness();
    await expect(
      materializeThreadGoal(draft({ objective: "x".repeat(4001) }), {
        ...h.options,
        getAgentRoot: () => `/${"x".repeat(4001)}`,
      }),
    ).rejects.toThrow("reference exceeds");
    expect(h.files.remove).toHaveBeenCalledOnce();
    expect(h.files.write).not.toHaveBeenCalled();
  });

  it("调用方保存失败可清理，成功默认保留且清理幂等", async () => {
    const h = harness();
    const result = await materializeThreadGoal(
      draft({ pastedTextAttachments: [{ text: "paste" }] }),
      h.options,
    );
    expect(h.files.remove).not.toHaveBeenCalled();
    await result.cleanup();
    await result.cleanup();
    expect(h.files.remove).toHaveBeenCalledExactlyOnceWith(directory);
  });
});

describe("ThreadGoalAttachmentStore ownership", () => {
  it("只写 owned 目录并消除文件名路径，拒绝 foreign 目录删除", async () => {
    const h = harness();
    const store = new ThreadGoalAttachmentStore(h.options);
    await expect(store.remove(directory)).rejects.toThrow("Unknown");
    await expect(
      store.write({
        directoryPath: directory,
        filename: "outside.txt",
        contents: new Uint8Array(),
      }),
    ).rejects.toThrow("Unknown");
    await store.createDirectory();
    expect(
      await store.write({
        directoryPath: directory,
        filename: "../folder/a:b.txt",
        contents: new Uint8Array([1]),
      }),
    ).toMatchObject({ label: "a_b.txt", path: `${directory}/a_b.txt` });
    expect(
      await store.write({
        directoryPath: directory,
        filename: "..",
        contents: new Uint8Array(),
      }),
    ).toMatchObject({ label: "attachment" });
    await expect(store.remove("/source.png")).rejects.toThrow("Unknown");
    await store.remove(directory);
    await expect(store.remove(directory)).rejects.toThrow("Unknown");
    expect(h.files.remove).toHaveBeenCalledExactlyOnceWith(directory);
  });

  it("拒绝无效 UUID 和 root 变化后的删除", async () => {
    const h = harness();
    await expect(
      new ThreadGoalAttachmentStore({
        ...h.options,
        createId: () => "../escape",
      }).createDirectory(),
    ).rejects.toThrow("Invalid");
    let root = "/isolated/app-server";
    const store = new ThreadGoalAttachmentStore({
      ...h.options,
      getAgentRoot: () => root,
    });
    await store.createDirectory();
    root = "/other/app-server";
    await expect(store.remove(directory)).rejects.toThrow("Invalid");
    expect(h.files.remove).not.toHaveBeenCalled();
  });

  it("Windows Agent root 与素材始终使用同一路径分隔符", async () => {
    const h = harness();
    const store = new ThreadGoalAttachmentStore({
      ...h.options,
      getAgentRoot: () => "D:\\Agent Root\\",
    });
    expect((await store.createDirectory()).path).toBe(
      `D:\\Agent Root\\attachments\\${id}`,
    );
  });
});
