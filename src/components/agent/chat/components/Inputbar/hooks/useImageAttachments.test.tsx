import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageAttachments } from "./useImageAttachments";

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

function Harness() {
  const { pendingImages, handlePaste, handleRemoveImage } =
    useImageAttachments();

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
        data-testid="remove-image"
        onClick={() => handleRemoveImage(0)}
      >
        删除图片
      </button>
      <div data-testid="image-count">{pendingImages.length}</div>
      <div data-testid="image-type">{pendingImages[0]?.mediaType || ""}</div>
    </div>
  );
}

function renderHarness(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Harness />);
  });

  mountedRoots.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      FileReader: typeof FileReader;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.FileReader = MockFileReader as never;
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

describe("useImageAttachments", () => {
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
});
