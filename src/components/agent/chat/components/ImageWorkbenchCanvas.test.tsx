import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  clickElement,
  clickButtonByText,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import { ImageWorkbenchCanvas } from "./ImageWorkbenchCanvas";

setupReactActEnvironment();

describe("ImageWorkbenchCanvas", () => {
  const mountedRoots: MountedRoot[] = [];
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    };
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
  });

  it("应默认收起任务详情，并在点击任务卡后于卡内展开操作区", () => {
    const onSeedFollowUpCommand = vi.fn();
    const onOpenImage = vi.fn();
    const onApplySelectedOutput = vi.fn();
    const onSelectOutput = vi.fn();

    const { container } = mountHarness(
      ImageWorkbenchCanvas,
      {
        tasks: [
          {
            id: "task-1",
            mode: "generate",
            status: "complete",
            prompt: "城市夜景海报",
            rawText: "@配图 生成 城市夜景海报",
            expectedCount: 1,
            outputIds: ["output-1"],
            createdAt: Date.now(),
          },
        ],
        outputs: [
          {
            id: "output-1",
            refId: "img-1",
            taskId: "task-1",
            url: "https://example.com/image.png",
            prompt: "城市夜景海报",
            createdAt: Date.now(),
            providerName: "Fal",
            modelName: "nano-banana",
            size: "1024x1024",
          },
        ],
        selectedOutputId: "output-1",
        viewport: { x: 0, y: 0, scale: 1 },
        preferenceSummary: "来源：全局图片设置 · Fal / Nano Banana Pro",
        preferenceWarning: null,
        availableProviders: [{ id: "fal", name: "Fal" }],
        selectedProviderId: "fal",
        onProviderChange: vi.fn(),
        availableModels: [
          {
            id: "nano-banana",
            name: "nano-banana",
            supportedSizes: ["1024x1024"],
          },
        ],
        selectedModelId: "nano-banana",
        onModelChange: vi.fn(),
        selectedSize: "1024x1024",
        onSizeChange: vi.fn(),
        generating: false,
        savingToResource: false,
        onViewportChange: vi.fn(),
        onSelectOutput,
        onSaveSelectedToLibrary: vi.fn(),
        applySelectedOutputLabel: "应用到文稿",
        onApplySelectedOutput,
        onSeedFollowUpCommand,
        onOpenImage,
      },
      mountedRoots,
    );

    const taskCard = container.querySelector(
      '[data-testid="image-workbench-task-task-1"]',
    );
    expect(taskCard?.getAttribute("data-expanded")).toBe("false");
    expect(
      container.querySelector('[data-testid="image-workbench-task-detail-task-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="image-workbench-preference-summary"]')
        ?.textContent,
    ).toContain("来源：全局图片设置");
    expect(
      container.querySelector('[data-testid="image-workbench-view-scale"]')
        ?.textContent,
    ).toContain("100%");
    expect(container.textContent).toContain(
      "结果留在任务卡内，对话区会同步进度与结果摘要",
    );
    expect(container.textContent).toContain("1/1 输出");
    expect(container.textContent).not.toContain("主图优先展示当前选中结果");
    expect(container.textContent).not.toContain("X 0 / Y 0");

    clickElement(taskCard);

    expect(taskCard?.getAttribute("data-expanded")).toBe("true");
    expect(
      container.querySelector('[data-testid="image-workbench-task-detail-task-1"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("当前查看");
    expect(container.textContent).toContain("提示词");
    expect(container.textContent).toContain("应用到文稿");

    clickButtonByText(container, "编辑", { exact: true });
    clickButtonByText(container, "原图", { exact: true });
    clickButtonByText(container, "应用到文稿", { exact: true });

    expect(onSelectOutput).not.toHaveBeenCalled();
    expect(onSeedFollowUpCommand).toHaveBeenCalledWith("@配图 编辑 #img-1 ");
    expect(onOpenImage).toHaveBeenCalledWith("https://example.com/image.png");
    expect(onApplySelectedOutput).toHaveBeenCalledTimes(1);
  });

  it("多版本任务展开后应以轻量版本带切换结果", () => {
    const onSelectOutput = vi.fn();

    const { container } = mountHarness(
      ImageWorkbenchCanvas,
      {
        tasks: [
          {
            id: "task-2",
            mode: "variation",
            status: "complete",
            prompt: "城市夜景海报，更多电影感版本",
            rawText: "@配图 重绘 #img-1 更偏电影感",
            expectedCount: 2,
            outputIds: ["output-1", "output-2"],
            createdAt: Date.now(),
          },
        ],
        outputs: [
          {
            id: "output-1",
            refId: "img-1",
            taskId: "task-2",
            url: "https://example.com/image-1.png",
            prompt: "版本一",
            createdAt: Date.now(),
            providerName: "Fal",
            modelName: "nano-banana",
            size: "1024x1024",
          },
          {
            id: "output-2",
            refId: "img-2",
            taskId: "task-2",
            url: "https://example.com/image-2.png",
            prompt: "版本二",
            createdAt: Date.now() + 1000,
            providerName: "Fal",
            modelName: "nano-banana",
            size: "1024x1024",
          },
        ],
        selectedOutputId: "output-1",
        viewport: { x: 0, y: 0, scale: 1 },
        preferenceSummary: null,
        preferenceWarning: null,
        availableProviders: [{ id: "fal", name: "Fal" }],
        selectedProviderId: "fal",
        onProviderChange: vi.fn(),
        availableModels: [
          {
            id: "nano-banana",
            name: "nano-banana",
            supportedSizes: ["1024x1024"],
          },
        ],
        selectedModelId: "nano-banana",
        onModelChange: vi.fn(),
        selectedSize: "1024x1024",
        onSizeChange: vi.fn(),
        generating: false,
        savingToResource: false,
        onViewportChange: vi.fn(),
        onSelectOutput,
        onSaveSelectedToLibrary: vi.fn(),
        applySelectedOutputLabel: "应用到文稿",
        onApplySelectedOutput: vi.fn(),
        onSeedFollowUpCommand: vi.fn(),
        onOpenImage: vi.fn(),
      },
      mountedRoots,
    );

    const taskCard = container.querySelector(
      '[data-testid="image-workbench-task-task-2"]',
    );

    clickElement(taskCard);

    expect(
      container.querySelector('[data-testid="image-workbench-task-versions-task-2"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("切换版本");
    expect(container.textContent).toContain("2 个结果");

    const versionButton = container.querySelector(
      'button[aria-label="切换到版本 img-2"]',
    );
    clickElement(versionButton);

    expect(onSelectOutput).toHaveBeenCalledWith("output-2");
  });

  it("生成中时应显示停止按钮，并触发 onStopGeneration", () => {
    const onStopGeneration = vi.fn();

    const { container } = mountHarness(
      ImageWorkbenchCanvas,
      {
        tasks: [
          {
            id: "task-3",
            mode: "generate",
            status: "running",
            prompt: "海报主视觉",
            rawText: "@配图 生成 海报主视觉",
            expectedCount: 1,
            outputIds: [],
            createdAt: Date.now(),
          },
        ],
        outputs: [],
        selectedOutputId: null,
        viewport: { x: 0, y: 0, scale: 1 },
        preferenceSummary: null,
        preferenceWarning: null,
        availableProviders: [{ id: "fal", name: "Fal" }],
        selectedProviderId: "fal",
        onProviderChange: vi.fn(),
        availableModels: [
          {
            id: "nano-banana",
            name: "nano-banana",
            supportedSizes: ["1024x1024"],
          },
        ],
        selectedModelId: "nano-banana",
        onModelChange: vi.fn(),
        selectedSize: "1024x1024",
        onSizeChange: vi.fn(),
        generating: true,
        savingToResource: false,
        onStopGeneration,
        onViewportChange: vi.fn(),
        onSelectOutput: vi.fn(),
        onSaveSelectedToLibrary: vi.fn(),
        onApplySelectedOutput: vi.fn(),
        onSeedFollowUpCommand: vi.fn(),
        onOpenImage: vi.fn(),
      },
      mountedRoots,
    );

    expect(container.textContent).toContain("处理中");

    clickButtonByText(container, "停止", { exact: true });

    expect(onStopGeneration).toHaveBeenCalledTimes(1);
  });

  it("仅展示处理中状态时，不应出现误导性的停止按钮", () => {
    const { container } = mountHarness(
      ImageWorkbenchCanvas,
      {
        tasks: [
          {
            id: "task-4",
            mode: "generate",
            status: "queued",
            prompt: "异步图片任务",
            rawText: "@配图 生成 异步图片任务",
            expectedCount: 1,
            outputIds: [],
            createdAt: Date.now(),
          },
        ],
        outputs: [],
        selectedOutputId: null,
        viewport: { x: 0, y: 0, scale: 1 },
        preferenceSummary: null,
        preferenceWarning: null,
        availableProviders: [{ id: "fal", name: "Fal" }],
        selectedProviderId: "fal",
        onProviderChange: vi.fn(),
        availableModels: [
          {
            id: "nano-banana",
            name: "nano-banana",
            supportedSizes: ["1024x1024"],
          },
        ],
        selectedModelId: "nano-banana",
        onModelChange: vi.fn(),
        selectedSize: "1024x1024",
        onSizeChange: vi.fn(),
        generating: true,
        savingToResource: false,
        onViewportChange: vi.fn(),
        onSelectOutput: vi.fn(),
        onSaveSelectedToLibrary: vi.fn(),
        onApplySelectedOutput: vi.fn(),
        onSeedFollowUpCommand: vi.fn(),
        onOpenImage: vi.fn(),
      },
      mountedRoots,
    );

    expect(container.textContent).toContain("处理中");
    expect(container.textContent).not.toContain("停止");
  });
});
