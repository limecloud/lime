import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  getPendingAppSnapshot,
  resetPendingAppSnapshotForTest,
  setPendingAppSnapshot,
} from "@/lib/pendingAppSnapshot";
import { useComposerAttachments } from "./useComposerAttachments";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { MAX_IMAGE_ATTACHMENTS_PER_TURN } from "../utils/imageAttachments";

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];
const originalFileReader = globalThis.FileReader;
const restoredImage = { data: "cmVzdG9yZWQ=", mediaType: "image/png" };

class MockFileReader {
  public onload: ((event: { target: { result: string } }) => void) | null =
    null;
  public onerror: (() => void) | null = null;
  public error: Error | null = null;

  readAsDataURL(file: File) {
    this.onload?.({
      target: {
        result: `data:${file.type};base64,ZmFrZS1pbWFnZQ==`,
      },
    });
  }
}

const deferredReaders: DeferredFileReader[] = [];

class DeferredFileReader extends MockFileReader {
  private file: File | null = null;

  readAsDataURL(file: File) {
    this.file = file;
    deferredReaders.push(this);
  }

  resolve(data = "ZmFrZS1pbWFnZQ==") {
    this.onload?.({
      target: { result: `data:${this.file?.type};base64,${data}` },
    });
  }

  reject() {
    this.error = new Error("delayed_read_failed");
    this.onerror?.();
  }
}

function Harness({ controller }: { controller?: ComposerController }) {
  const {
    pendingImages,
    handlePaste,
    handleRemoveImage,
    clearPendingImages,
    replacePendingImages,
  } = useComposerAttachments({ controller });

  return (
    <div>
      <button
        type="button"
        data-testid="paste-image"
        onClick={() => {
          const file = new File(["image"], "clipboard.png", {
            type: "image/png",
          });
          handlePaste({
            preventDefault: vi.fn(),
            clipboardData: {
              items: [],
              files: [file],
            },
          } as never);
        }}
      >
        粘贴图片
      </button>
      <button
        type="button"
        data-testid="paste-image-from-item-type"
        onClick={() => {
          const file = new File(["image"], "clipboard-image", {
            type: "",
          });
          const preventDefault = vi.fn();
          handlePaste({
            preventDefault,
            clipboardData: {
              items: [
                {
                  kind: "file",
                  type: "image/png",
                  getAsFile: () => file,
                },
              ],
              files: [],
            },
          } as never);
        }}
      >
        从项类型粘贴图片
      </button>
      <button
        type="button"
        data-testid="paste-many-images"
        onClick={() => {
          const files = Array.from(
            { length: 25 },
            (_, index) =>
              new File(["image"], `clipboard-${index}.png`, {
                type: "image/png",
              }),
          );
          handlePaste({
            preventDefault: vi.fn(),
            clipboardData: {
              items: [],
              files,
            },
          } as never);
        }}
      >
        批量粘贴图片
      </button>
      <button
        type="button"
        data-testid="remove-image"
        onClick={() => handleRemoveImage(0)}
      >
        删除图片
      </button>
      <button data-testid="clear-images" onClick={clearPendingImages}>
        清空图片
      </button>
      <button
        data-testid="replace-images"
        onClick={() => replacePendingImages([restoredImage])}
      >
        恢复图片
      </button>
      <div data-testid="image-count">{pendingImages.length}</div>
      <div data-testid="image-type">{pendingImages[0]?.mediaType || ""}</div>
      <div data-testid="images">{JSON.stringify(pendingImages)}</div>
    </div>
  );
}

function renderHarness(controller?: ComposerController): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Harness controller={controller} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      FileReader: typeof FileReader;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.FileReader = MockFileReader as never;
  resetPendingAppSnapshotForTest();
  await changeLimeLocale("zh-CN");
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
  globalThis.FileReader = originalFileReader;
  vi.clearAllMocks();
});

describe("useComposerAttachments", () => {
  it("应支持从 clipboardData.files 直接粘贴图片", async () => {
    const container = renderHarness();
    const pasteButton = container.querySelector(
      '[data-testid="paste-image"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      pasteButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="image-count"]')?.textContent,
    ).toBe("1");
    expect(
      container.querySelector('[data-testid="image-type"]')?.textContent,
    ).toBe("image/png");
    expect(toastMock.success).toHaveBeenCalledWith("已粘贴图片");
  });

  it("删除图片后应从待发送列表移除", async () => {
    const container = renderHarness();
    const pasteButton = container.querySelector(
      '[data-testid="paste-image"]',
    ) as HTMLButtonElement | null;
    const removeButton = container.querySelector(
      '[data-testid="remove-image"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      pasteButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      removeButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="image-count"]')?.textContent,
    ).toBe("0");
  });

  it("应支持从 clipboardData.items 的 type 回退识别粘贴图片", async () => {
    const container = renderHarness();
    const pasteButton = container.querySelector(
      '[data-testid="paste-image-from-item-type"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      pasteButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="image-count"]')?.textContent,
    ).toBe("1");
    expect(
      container.querySelector('[data-testid="image-type"]')?.textContent,
    ).toBe("image/png");
    expect(toastMock.success).toHaveBeenCalledWith("已粘贴图片");
  });

  it("图片粘贴反馈应跟随 en-US 资源", async () => {
    await changeLimeLocale("en-US");
    const container = renderHarness();
    const pasteButton = container.querySelector(
      '[data-testid="paste-image"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      pasteButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="image-count"]')?.textContent,
    ).toBe("1");
    expect(toastMock.success).toHaveBeenCalledWith("Image pasted");
  });

  it("单轮最多保留 20 张待发送图片", async () => {
    const container = renderHarness();
    const pasteButton = container.querySelector(
      '[data-testid="paste-many-images"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      pasteButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="image-count"]')?.textContent,
    ).toBe("20");
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe("useComposerAttachments 读取生命周期", () => {
  beforeEach(() => {
    deferredReaders.length = 0;
    globalThis.FileReader = DeferredFileReader as never;
  });

  function click(container: HTMLDivElement, action: string) {
    const button = container.querySelector<HTMLButtonElement>(
      `[data-testid="${action}"]`,
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
  }

  function images(container: HTMLDivElement) {
    return JSON.parse(
      container.querySelector('[data-testid="images"]')?.textContent ?? "[]",
    );
  }

  async function finish(index: number, outcome: "resolve" | "reject") {
    expect(deferredReaders[index]).toBeDefined();
    await act(async () => {
      deferredReaders[index][outcome]();
      await Promise.resolve();
    });
  }

  function createRichController() {
    const controller = new ComposerController({
      text: "原草稿😀",
      attachments: [restoredImage],
      pathReferences: [
        { id: "brief", path: "/tmp/brief.md", name: "brief.md", isDir: false },
      ],
    });
    controller.insertMention(
      {
        id: "review",
        kind: "skill",
        name: "review",
        path: "/skills/review/SKILL.md",
        label: "/review",
      },
      { start: 0, end: 0 },
    );
    controller.setSelection(controller.getDocument().text.length);
    controller.ingestPaste("长文😀".repeat(300));
    return controller;
  }

  it("注入 owner 挂载保留 rich JSON、图片、路径与 revision，删除只修改其资源", () => {
    const controller = createRichController();
    const beforeMount = controller.getSnapshot();
    const container = renderHarness(controller);
    expect(images(container)).toEqual([restoredImage]);
    expect(controller.getSnapshot()).toBe(beforeMount);
    click(container, "remove-image");
    expect(images(container)).toEqual([]);
    expect(controller.getDocument().editorDocument).toEqual(
      beforeMount.document.editorDocument,
    );
    expect(controller.getDocument().pathReferences).toEqual(
      beforeMount.document.pathReferences,
    );
    expect(controller.getDocument().pendingPastes).toEqual(
      beforeMount.document.pendingPastes,
    );
  });

  it.each(["clear", "restore", "replaceText", "replaceImages"])(
    "外部 %s 隔离旧成功与失败读取，新读取可继续追加同 owner",
    async (action) => {
      const controller = createRichController();
      const container = renderHarness(controller);
      click(container, "paste-image");
      click(container, "paste-image");
      act(() => {
        if (action === "clear") controller.clear();
        else if (action === "restore")
          controller.restoreDraft(controller.captureDraft());
        else if (action === "replaceText") controller.setText("外部新草稿");
        else
          controller.setAttachments([
            { data: "external", mediaType: "image/png" },
          ]);
      });
      const afterReset = controller.captureDraft();
      await finish(0, "resolve");
      await finish(1, "reject");
      expect(controller.captureDraft()).toEqual(afterReset);
      expect(images(container)).toEqual(afterReset.attachments);
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).not.toHaveBeenCalled();
      click(container, "paste-image");
      await finish(2, "resolve");
      expect(controller.getDocument().attachments).toEqual([
        ...afterReset.attachments,
        { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
      ]);
      expect(toastMock.success).toHaveBeenCalledOnce();
    },
  );

  it.each(["clear", "restore"])(
    "重复 %s 之间发起的读取在第二次重置后隔离旧成功与失败",
    async (action) => {
      const controller = createRichController();
      const container = renderHarness(controller);
      const draft = controller.captureDraft();
      const reset = () =>
        action === "clear"
          ? controller.clear()
          : controller.restoreDraft(draft);
      act(reset);
      click(container, "paste-image");
      click(container, "paste-image");
      const beforeSecondReset = controller.getSnapshot();
      act(reset);
      const afterSecondReset = controller.captureDraft();
      expect(controller.getSnapshot().revision).toBe(
        beforeSecondReset.revision + 1,
      );

      await finish(0, "resolve");
      await finish(1, "reject");
      expect(controller.captureDraft()).toEqual(afterSecondReset);
      expect(images(container)).toEqual(afterSecondReset.attachments);
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).not.toHaveBeenCalled();

      click(container, "paste-image");
      await finish(2, "resolve");
      expect(controller.getDocument().attachments).toEqual([
        ...afterSecondReset.attachments,
        { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
      ]);
      expect(toastMock.success).toHaveBeenCalledOnce();
    },
  );

  it("普通 PM 编辑、路径更新与自身多图 append 不取消同代读取", async () => {
    const controller = createRichController();
    const container = renderHarness(controller);
    click(container, "paste-image");
    click(container, "paste-image");
    act(() => {
      const state = controller.getEditorState();
      controller.applyTransaction(
        state.tr.insertText("新编辑", state.selection.to),
      );
      controller.setPathReferences([
        { id: "new-path", path: "/tmp/new.md", name: "new.md", isDir: false },
      ]);
    });
    const beforeReads = controller.captureDraft();
    await finish(0, "resolve");
    await finish(1, "resolve");
    expect(controller.getDocument().attachments).toEqual([
      restoredImage,
      { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
      { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
    ]);
    expect(controller.getDocument().editorDocument).toEqual(
      beforeReads.editorDocument,
    );
    expect(controller.getDocument().pathReferences).toEqual(
      beforeReads.pathReferences,
    );
    expect(toastMock.success).toHaveBeenCalledTimes(2);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("切换 Controller scope 后旧读取不写入任何工作区", async () => {
    const oldController = createRichController();
    const container = renderHarness(oldController);
    click(container, "paste-image");
    const nextController = new ComposerController({
      attachments: [{ data: "next", mediaType: "image/png" }],
    });
    const mounted = mountedRoots.find((entry) => entry.container === container);
    act(() => mounted?.root.render(<Harness controller={nextController} />));
    await finish(0, "resolve");
    expect(oldController.getDocument().attachments).toEqual([restoredImage]);
    expect(nextController.getDocument().attachments).toEqual([
      { data: "next", mediaType: "image/png" },
    ]);
    expect(images(container)).toEqual(nextController.getDocument().attachments);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("自身 append 通知期间的外部同步替换仍隔离其余读取与旧提示", async () => {
    const controller = createRichController();
    const container = renderHarness(controller);
    let replaced = false;
    const externalImage = { data: "external", mediaType: "image/png" };
    const unsubscribe = controller.subscribe(() => {
      if (!replaced && controller.getDocument().attachments.length > 1) {
        replaced = true;
        controller.setAttachments([externalImage]);
      }
    });
    try {
      click(container, "paste-image");
      click(container, "paste-image");
      await finish(0, "resolve");
      await finish(1, "resolve");
      expect(controller.getDocument().attachments).toEqual([externalImage]);
      expect(images(container)).toEqual([externalImage]);
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it.each(["clear-images", "replace-images"])(
    "%s 后迟到成功不回流，新读取仍能接收",
    async (action) => {
      const container = renderHarness();
      click(container, "paste-image");
      await finish(0, "resolve");
      expect(images(container)).toHaveLength(1);
      toastMock.success.mockClear();

      click(container, "paste-image");
      click(container, action);
      click(container, "paste-image");
      const expected = action === "replace-images" ? [restoredImage] : [];

      await finish(1, "resolve");
      expect(images(container)).toEqual(expected);
      expect(toastMock.success).not.toHaveBeenCalled();

      await finish(2, "resolve");
      expect(images(container)).toEqual([
        ...expected,
        { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
      ]);
      expect(toastMock.success).toHaveBeenCalledOnce();
      expect(toastMock.error).not.toHaveBeenCalled();
    },
  );

  it.each(["clear-images", "replace-images"])(
    "%s 后迟到失败不显示旧错误",
    async (action) => {
      const container = renderHarness();
      click(container, "paste-image");
      click(container, action);
      await finish(0, "reject");

      expect(images(container)).toEqual(
        action === "replace-images" ? [restoredImage] : [],
      );
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "卸载后迟到 %s 不显示旧提示",
    async (outcome) => {
      const container = renderHarness();
      click(container, "paste-image");
      const mounted = mountedRoots.pop();
      expect(mounted).toBeDefined();
      act(() => mounted?.root.unmount());
      mounted?.container.remove();

      await finish(0, outcome);
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).not.toHaveBeenCalled();
    },
  );

  it("同代读取失败仍显示错误并保留已有草稿", async () => {
    const container = renderHarness();
    click(container, "replace-images");
    click(container, "paste-image");
    await finish(0, "reject");

    expect(images(container)).toEqual([restoredImage]);
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("useComposerAttachments 应用快照", () => {
  const pendingSnapshot = {
    dataUrl: "data:image/png;base64,ZmFrZS1zbmFwc2hvdA==",
    windowName: "Editor",
  };

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function imageCount(container: HTMLDivElement) {
    return container.querySelector('[data-testid="image-count"]')?.textContent;
  }

  function images(container: HTMLDivElement) {
    return JSON.parse(
      container.querySelector('[data-testid="images"]')?.textContent ?? "[]",
    );
  }

  it("挂载时消费待发送快照，走现有图片路径只追加一次", async () => {
    setPendingAppSnapshot(pendingSnapshot);
    const first = renderHarness();
    await flush();

    expect(imageCount(first)).toBe("1");
    expect(images(first)).toEqual([
      { data: "ZmFrZS1pbWFnZQ==", mediaType: "image/png" },
    ]);
    expect(getPendingAppSnapshot()).toBeNull();
    expect(toastMock.success).toHaveBeenCalledWith("已添加图片：Editor.png");

    const second = renderHarness();
    await flush();
    expect(imageCount(second)).toBe("0");
    expect(toastMock.success).toHaveBeenCalledOnce();
  });

  it("data URL 无效时提示错误并把快照留给下次重试", async () => {
    const invalidSnapshot = {
      dataUrl: "data:text/plain;base64,ZmFrZQ==",
      windowName: "Editor",
    };
    setPendingAppSnapshot(invalidSnapshot);
    const container = renderHarness();
    await flush();

    expect(imageCount(container)).toBe("0");
    expect(getPendingAppSnapshot()).toEqual(invalidSnapshot);
    expect(toastMock.error).toHaveBeenCalledWith("图片读取失败：Editor.png");
  });

  it("读取失败时保留快照，重新挂载后可成功追加", async () => {
    setPendingAppSnapshot(pendingSnapshot);
    class FailingFileReader extends MockFileReader {
      readAsDataURL() {
        this.error = new Error("delayed_read_failed");
        this.onerror?.();
      }
    }
    globalThis.FileReader = FailingFileReader as never;
    const first = renderHarness();
    await flush();

    expect(imageCount(first)).toBe("0");
    expect(getPendingAppSnapshot()).toEqual(pendingSnapshot);
    expect(toastMock.error).toHaveBeenCalledWith("图片读取失败：Editor.png");

    const mounted = mountedRoots.pop();
    expect(mounted).toBeDefined();
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    globalThis.FileReader = MockFileReader as never;

    const retry = renderHarness();
    await flush();
    expect(imageCount(retry)).toBe("1");
    expect(getPendingAppSnapshot()).toBeNull();
  });

  it("达到附件上限时不越权追加，并保留快照", async () => {
    const controller = new ComposerController({
      attachments: Array.from(
        { length: MAX_IMAGE_ATTACHMENTS_PER_TURN },
        (_, index) => ({ data: `existing-${index}`, mediaType: "image/png" }),
      ),
    });
    setPendingAppSnapshot(pendingSnapshot);
    const container = renderHarness(controller);
    await flush();

    expect(imageCount(container)).toBe(String(MAX_IMAGE_ATTACHMENTS_PER_TURN));
    expect(controller.getDocument().attachments).toHaveLength(
      MAX_IMAGE_ATTACHMENTS_PER_TURN,
    );
    expect(getPendingAppSnapshot()).toEqual(pendingSnapshot);
    expect(toastMock.error).toHaveBeenCalledWith("图片读取失败：Editor.png");
  });
});
