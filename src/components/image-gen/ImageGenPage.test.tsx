import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, PageParams } from "@/types/page";
import type { GeneratedImage } from "./types";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  silenceConsole,
  type MountedRoot,
} from "./test-utils";

const {
  mockBackfillImagesToResource,
  mockGenerateImage,
  mockDeleteImage,
  mockNewImage,
  mockToast,
} = vi.hoisted(() => ({
  mockBackfillImagesToResource: vi.fn(),
  mockGenerateImage: vi.fn(),
  mockDeleteImage: vi.fn(),
  mockNewImage: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => {
    const defaultProject = {
      id: "project-default",
      name: "默认项目",
      workspaceType: "persistent",
      rootPath: "/tmp/default",
      isDefault: true,
      icon: undefined,
      color: undefined,
      isFavorite: false,
      isArchived: false,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return {
      projects: [defaultProject],
      filteredProjects: [defaultProject],
      defaultProject,
      loading: false,
      error: null,
      filter: {},
      setFilter: vi.fn(),
      refresh: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getOrCreateDefault: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useProject", () => ({
  useProject: () => ({
    project: {
      id: "project-default",
      name: "默认项目",
      workspaceType: "persistent",
      rootPath: "/tmp/default",
      isDefault: true,
      settings: {},
      isFavorite: false,
      isArchived: false,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("./useImageGen", async () => {
  const React = await import("react");

  const images: GeneratedImage[] = [
    {
      id: "img-1",
      url: "https://example.com/1.png",
      prompt: "第一张提示词",
      model: "fal-ai/nano-banana-pro",
      size: "1024x1024",
      providerId: "fal",
      providerName: "Fal",
      createdAt: 1700000000000,
      status: "complete",
    },
    {
      id: "img-2",
      url: "https://example.com/2.png",
      prompt: "第二张提示词",
      model: "fal-ai/nano-banana-pro",
      size: "1024x1024",
      providerId: "fal",
      providerName: "Fal",
      createdAt: 1700000001000,
      status: "complete",
    },
  ];

  return {
    useImageGen: () => {
      const [selectedImageId, setSelectedImageId] = React.useState<
        string | null
      >(images[0].id);
      const selectedImage =
        images.find((image) => image.id === selectedImageId) ?? images[0];

      return {
        availableProviders: [
          {
            id: "fal",
            type: "fal",
            name: "Fal",
            enabled: true,
            api_key_count: 1,
            api_host: "https://fal.run",
          },
        ],
        selectedProvider: {
          id: "fal",
          type: "fal",
          name: "Fal",
          enabled: true,
          api_key_count: 1,
          api_host: "https://fal.run",
        },
        selectedProviderId: "fal",
        setSelectedProviderId: vi.fn(),
        providersLoading: false,
        availableModels: [
          {
            id: "fal-ai/nano-banana-pro",
            name: "Nano Banana Pro",
            supportedSizes: ["1024x1024"],
          },
        ],
        selectedModel: {
          id: "fal-ai/nano-banana-pro",
          name: "Nano Banana Pro",
          supportedSizes: ["1024x1024"],
        },
        selectedModelId: "fal-ai/nano-banana-pro",
        setSelectedModelId: vi.fn(),
        selectedSize: "1024x1024",
        setSelectedSize: vi.fn(),
        images,
        selectedImage,
        selectedImageId,
        setSelectedImageId,
        generating: false,
        savingToResource: false,
        generateImage: mockGenerateImage,
        backfillImagesToResource: mockBackfillImagesToResource,
        deleteImage: mockDeleteImage,
        newImage: mockNewImage,
      };
    },
  };
});

import { ImageGenPage } from "./ImageGenPage";

const mountedRoots: MountedRoot[] = [];

function renderPage(
  onNavigate?: (page: Page, params?: PageParams) => void,
): HTMLDivElement {
  return renderIntoDom(<ImageGenPage onNavigate={onNavigate} />, mountedRoots)
    .container;
}

function findButtonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text),
  );
  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return target as HTMLButtonElement;
}

function getPromptChip(container: HTMLElement): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll("div")).find(
    (node) => node.textContent === "当前图片提示词",
  );
  if (!label || !label.parentElement) {
    throw new Error("未找到提示词历史区域");
  }

  const chip = label.parentElement.querySelector("button");
  if (!chip) {
    throw new Error("未找到提示词历史按钮");
  }
  return chip as HTMLButtonElement;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

beforeEach(() => {
  setReactActEnvironment();

  localStorage.clear();
  vi.clearAllMocks();
  silenceConsole();
  mockBackfillImagesToResource.mockResolvedValue({
    total: 2,
    saved: 2,
    failed: 0,
    skipped: 0,
    errors: [],
  });
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ImageGenPage", () => {
  it("点击左上角返回按钮应回到新建任务页", async () => {
    const onNavigate = vi.fn();
    const container = renderPage(onNavigate);

    await flushEffects();

    const backButton = container.querySelector<HTMLButtonElement>(
      'button[title="返回新建任务"]',
    );
    expect(backButton).not.toBeNull();

    act(() => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        theme: "general",
        lockTheme: false,
        newChatAt: expect.any(Number),
      }),
    );
  });

  it("应仅显示当前选中图片的提示词历史", async () => {
    const container = renderPage();

    await flushEffects();

    const chipBefore = getPromptChip(container);
    expect(chipBefore.textContent).toContain("第一张提示词");

    const secondHistoryItem = container.querySelector<HTMLElement>(
      '[role="button"][title="第二张提示词"]',
    );
    expect(secondHistoryItem).not.toBeNull();

    act(() => {
      secondHistoryItem?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const chipAfter = getPromptChip(container);
    expect(chipAfter.textContent).toContain("第二张提示词");
  });

  it("点击补录按钮应使用目标项目触发历史补录", async () => {
    const container = renderPage();
    await flushEffects();

    const backfillButton = findButtonByText(container, "补录历史到资源库");
    expect(backfillButton.disabled).toBe(false);

    await act(async () => {
      backfillButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockBackfillImagesToResource).toHaveBeenCalledTimes(1);
    expect(mockBackfillImagesToResource).toHaveBeenCalledWith(
      "project-default",
    );
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("AI 生图布局应锁定父级高度避免小屏裁切输入区", async () => {
    const mounted = renderIntoDom(
      <div style={{ height: "640px", width: "960px" }}>
        <ImageGenPage />
      </div>,
      mountedRoots,
    );

    await flushEffects();

    const layout = mounted.container.querySelector<HTMLElement>(
      '[data-testid="ai-image-gen-layout"]',
    );
    expect(layout).not.toBeNull();

    const styles = Array.from(document.head.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    const hasExpectedRule = Array.from(layout?.classList || []).some(
      (className) =>
        new RegExp(
          `\\.${escapeRegExp(className)}\\{[^}]*height:100%;[^}]*overflow:hidden;`,
        ).test(styles),
    );

    expect(hasExpectedRule).toBe(true);
  });
});
