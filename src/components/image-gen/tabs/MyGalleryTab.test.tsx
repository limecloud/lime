import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "../test-utils";

const { mockConvertLocalFileSrc } = vi.hoisted(() => ({
  mockConvertLocalFileSrc: vi.fn(),
}));
const {
  mockEmitCanvasImageInsertRequest,
  mockOnCanvasImageInsertAck,
  mockGetActiveContentTarget,
} =
  vi.hoisted(() => ({
    mockEmitCanvasImageInsertRequest: vi.fn(),
    mockOnCanvasImageInsertAck: vi.fn(),
    mockGetActiveContentTarget: vi.fn(),
  }));
const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: mockConvertLocalFileSrc,
}));

vi.mock("@/lib/canvasImageInsertBus", () => ({
  emitCanvasImageInsertRequest: mockEmitCanvasImageInsertRequest,
  onCanvasImageInsertAck: mockOnCanvasImageInsertAck,
}));

vi.mock("@/lib/activeContentTarget", () => ({
  getActiveContentTarget: mockGetActiveContentTarget,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/components/workspace/media/ImageGallery", () => ({
  ImageGallery: ({
    onSelect,
    onDoubleClick,
  }: {
    onSelect?: (materials: unknown[]) => void;
    onDoubleClick?: (material: unknown) => void;
  }) => {
    const material = {
      id: "material-1",
      name: "城市夜景",
      type: "image",
      projectId: "project-1",
      filePath: "/tmp/city.jpg",
      tags: [],
      createdAt: Date.now(),
      metadata: {
        width: 1024,
        height: 768,
      },
    };

    return (
      <div data-testid="mock-image-gallery">
        <button
          type="button"
          onClick={() => {
            onSelect?.([material]);
          }}
        >
          选择素材
        </button>
        <button
          type="button"
          onClick={() => {
            onDoubleClick?.(material);
          }}
        >
          双击插入
        </button>
      </div>
    );
  },
}));

import { MyGalleryTab } from "./MyGalleryTab";

const mountedRoots: MountedRoot[] = [];

function renderTab(projectId: string | null = "project-1"): HTMLDivElement {
  const mounted = renderIntoDom(<MyGalleryTab projectId={projectId} />, mountedRoots);
  return mounted.container;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return target as HTMLButtonElement;
}

beforeEach(() => {
  setReactActEnvironment();
  vi.clearAllMocks();
  mockConvertLocalFileSrc.mockReturnValue("asset://city.jpg");
  mockOnCanvasImageInsertAck.mockReturnValue(() => undefined);
  mockGetActiveContentTarget.mockReturnValue({
    projectId: "project-1",
    contentId: "content-1",
    canvasType: "document",
  });
  mockEmitCanvasImageInsertRequest.mockReturnValue({
    requestId: "insert-1",
  });
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
});

describe("MyGalleryTab", () => {
  it("未选择项目时应提示先选择项目", () => {
    const container = renderTab(null);
    expect(container.textContent).toContain("请先选择项目");
  });

  it("应支持选中后插入文稿", async () => {
    const container = renderTab("project-1");

    await act(async () => {
      findButton(container, "选择素材").click();
      await flushEffects();
    });

    await act(async () => {
      findButton(container, "插入选中图片到当前画布").click();
      await flushEffects();
    });

    expect(mockEmitCanvasImageInsertRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-1",
        canvasType: "document",
        source: "gallery",
        image: expect.objectContaining({
          contentUrl: "asset://city.jpg",
          title: "城市夜景",
        }),
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("双击素材应直接插入文稿", async () => {
    const container = renderTab("project-1");

    await act(async () => {
      findButton(container, "双击插入").click();
      await flushEffects();
    });

    expect(mockEmitCanvasImageInsertRequest).toHaveBeenCalledTimes(1);
  });
});
