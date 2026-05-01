import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenResourceManager } = vi.hoisted(() => ({
  mockOpenResourceManager: vi.fn(),
}));

vi.mock("@/features/resource-manager", () => ({
  openResourceManager: mockOpenResourceManager,
}));

import { ImageTaskViewer } from "./ImageTaskViewer";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createProps(
  overrides?: Partial<React.ComponentProps<typeof ImageTaskViewer>>,
): React.ComponentProps<typeof ImageTaskViewer> {
  return {
    tasks: [
      {
        id: "task-1",
        mode: "generate",
        status: "complete",
        prompt: "生成一张广州塔配图",
        rawText: "@配图 生成一张广州塔配图",
        expectedCount: 2,
        outputIds: ["output-1", "output-2"],
        createdAt: 1,
      },
    ],
    outputs: [
      {
        id: "output-1",
        refId: "img-1",
        taskId: "task-1",
        url: "https://example.com/image-1.png",
        prompt: "广州塔主视觉",
        createdAt: 1,
      },
      {
        id: "output-2",
        refId: "img-2",
        taskId: "task-1",
        url: "https://example.com/image-2.png",
        prompt: "广州塔夜景",
        createdAt: 2,
      },
    ],
    selectedOutputId: "output-1",
    viewport: { x: 0, y: 0, scale: 1 },
    preferenceSummary: null,
    preferenceWarning: null,
    availableProviders: [],
    selectedProviderId: "",
    onProviderChange: vi.fn(),
    availableModels: [],
    selectedModelId: "",
    onModelChange: vi.fn(),
    selectedSize: "1024x1024",
    onSizeChange: vi.fn(),
    generating: false,
    savingToResource: false,
    onViewportChange: vi.fn(),
    onSelectOutput: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function renderComponent(
  props?: Partial<React.ComponentProps<typeof ImageTaskViewer>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const mergedProps = createProps(props);

  act(() => {
    root.render(<ImageTaskViewer {...mergedProps} />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    props: mergedProps,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("ImageTaskViewer", () => {
  it("点击关闭按钮应调用 onClose", () => {
    const onClose = vi.fn();
    const { container } = renderComponent({ onClose });

    const closeButton = container.querySelector(
      '[data-testid="image-task-viewer-close"]',
    );
    expect(closeButton).toBeTruthy();

    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击大图应打开独立资源管理器并透传图片任务上下文", () => {
    const { container } = renderComponent({
      sourceProjectId: "project-1",
      sourceContentId: "content-1",
      sourceThreadId: "thread-1",
    });

    const openButton = container.querySelector(
      '[data-testid="image-task-viewer-open-image"]',
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockOpenResourceManager).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: "Image Generation",
        sourceContext: expect.objectContaining({
          kind: "image_task",
          projectId: "project-1",
          contentId: "content-1",
          taskId: "task-1",
          outputId: "output-1",
          threadId: "thread-1",
          sourcePage: "image-task-viewer",
        }),
        initialIndex: 0,
        items: [
          expect.objectContaining({
            id: "output-1",
            kind: "image",
            src: "https://example.com/image-1.png",
            title: "广州塔主视觉",
            sourceContext: expect.objectContaining({
              kind: "image_task",
              projectId: "project-1",
              contentId: "content-1",
              taskId: "task-1",
              outputId: "output-1",
              threadId: "thread-1",
            }),
          }),
          expect.objectContaining({
            id: "output-2",
            kind: "image",
            src: "https://example.com/image-2.png",
            title: "广州塔夜景",
            sourceContext: expect.objectContaining({
              kind: "image_task",
              projectId: "project-1",
              contentId: "content-1",
              taskId: "task-1",
              outputId: "output-2",
              threadId: "thread-1",
            }),
          }),
        ],
      }),
    );
  });

  it("大图舞台应保留稳定内边距，避免图片贴近上下边线", () => {
    const { container } = renderComponent();

    const stage = container.querySelector(
      '[data-testid="image-task-viewer-stage"]',
    ) as HTMLDivElement | null;
    const openButton = container.querySelector(
      '[data-testid="image-task-viewer-open-image"]',
    ) as HTMLButtonElement | null;

    expect(stage?.className).toContain("rounded-[20px]");
    expect(openButton?.className).toContain("rounded-[18px]");
    expect(openButton?.className).toContain("p-4");
    expect(openButton?.className).toContain("border-slate-200/80");
    expect(stage?.firstElementChild?.className).toContain("p-4");
    expect(stage?.firstElementChild?.className).toContain("pt-5");
  });

  it("结果图加载失败时应展示兜底文案并隐藏打开原图入口", () => {
    const { container } = renderComponent();

    const image = container.querySelector(
      'img[src="https://example.com/image-1.png"]',
    );
    expect(image).toBeTruthy();

    act(() => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(container.textContent).toContain("图片暂时无法显示");
    expect(container.textContent).toContain(
      "图片结果已经返回，但当前预览地址暂时无法加载。",
    );
    expect(
      container.querySelector('[data-testid="image-task-viewer-open-image"]'),
    ).toBeNull();
  });

  it("点击缩略图应切换当前输出", () => {
    const onSelectOutput = vi.fn();
    const { container } = renderComponent({ onSelectOutput });

    const thumbButtons = container.querySelectorAll("button");
    const nextThumbButton = Array.from(thumbButtons).find((button) =>
      button.querySelector('img[src="https://example.com/image-2.png"]'),
    );
    expect(nextThumbButton).toBeTruthy();

    act(() => {
      nextThumbButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onSelectOutput).toHaveBeenCalledWith("output-2");
  });

  it("多图结果应展示当前选中位次与缩略编号", () => {
    const { container } = renderComponent();

    const outputGrid = container.querySelector(
      '[data-testid="image-task-viewer-output-grid"]',
    ) as HTMLDivElement | null;

    expect(container.textContent).toContain("已选第 1 张");
    expect(container.textContent).toContain("2 张结果");
    expect(outputGrid?.textContent).toContain("1");
    expect(outputGrid?.textContent).toContain("2");
  });

  it("任务 viewer 应展示已按多模态运行合同路由的状态", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-contract-accepted-1",
          mode: "generate",
          status: "complete",
          prompt: "青柠品牌主视觉",
          rawText: "@配图 青柠品牌主视觉",
          expectedCount: 1,
          outputIds: ["output-contract-accepted-1"],
          createdAt: 1,
          runtimeContract: {
            contractKey: "image_generation",
            routingSlot: "image_task",
            routingEvent: "model_routing_decision",
            routingOutcome: "accepted",
            limecorePolicyEvaluationStatus: "input_gap",
            limecorePolicyEvaluationDecision: "ask",
            limecorePolicyEvaluationPendingRefs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
          },
        },
      ],
      outputs: [
        {
          id: "output-contract-accepted-1",
          refId: "img-contract-accepted-1",
          taskId: "task-contract-accepted-1",
          url: "https://example.com/contract-accepted.png",
          prompt: "青柠品牌主视觉",
          createdAt: 1,
        },
      ],
      selectedOutputId: "output-contract-accepted-1",
    });

    const badge = container.querySelector(
      '[data-testid="image-task-viewer-runtime-contract"]',
    );

    expect(badge?.textContent).toContain(
      "运行合同 · 已按 image_generation 路由",
    );
    expect(container.textContent).toContain("LimeCore 策略输入待命中: 3");
  });

  it("任务 viewer 应展示合同阻止与 registry 能力缺口", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-contract-blocked-1",
          mode: "generate",
          status: "error",
          prompt: "青柠品牌主视觉",
          rawText: "@配图 青柠品牌主视觉",
          expectedCount: 1,
          outputIds: [],
          createdAt: 1,
          failureMessage: "model registry 显示当前模型不具备图片生成能力。",
          runtimeContract: {
            contractKey: "image_generation",
            routingSlot: "image_task",
            providerId: "openai",
            model: "gpt-5.2",
            routingEvent: "routing_not_possible",
            routingOutcome: "blocked",
            failureCode: "image_generation_model_capability_gap",
            modelCapabilityAssessmentSource: "model_registry",
            modelSupportsImageGeneration: false,
          },
        },
      ],
      outputs: [],
      selectedOutputId: null,
    });

    expect(container.textContent).toContain(
      "运行合同阻止 · image_generation_model_capability_gap",
    );
    expect(container.textContent).toContain(
      "模型能力来自 model_registry · 不支持图片生成",
    );
  });

  it("3x3 分镜任务应使用九宫格缩略布局并展示编号", () => {
    const outputs = Array.from({ length: 9 }, (_, index) => ({
      id: `output-storyboard-${index + 1}`,
      refId: `img-storyboard-${index + 1}`,
      taskId: "task-storyboard-1",
      url: `https://example.com/storyboard-${index + 1}.png`,
      prompt: `分镜 ${index + 1}`,
      slotIndex: index + 1,
      slotLabel: `第 ${index + 1} 格`,
      slotPrompt: `这是第 ${index + 1} 格的完整提示词`,
      createdAt: index + 1,
    }));

    const { container } = renderComponent({
      tasks: [
        {
          id: "task-storyboard-1",
          mode: "generate",
          status: "complete",
          prompt: "三国主要人物分镜",
          rawText: "@分镜 生成 三国主要人物分镜",
          expectedCount: 9,
          outputIds: outputs.map((output) => output.id),
          layoutHint: "storyboard_3x3",
          storyboardSlots: outputs.map((output, index) => ({
            slotId: `storyboard-slot-${index + 1}`,
            slotIndex: index + 1,
            label: output.slotLabel,
            prompt: output.slotPrompt,
          })),
          createdAt: 1,
        },
      ],
      outputs,
      selectedOutputId: outputs[0]?.id,
    });

    const outputGrid = container.querySelector(
      '[data-testid="image-task-viewer-output-grid"]',
    ) as HTMLDivElement | null;

    expect(container.textContent).toContain("3x3 分镜");
    expect(container.textContent).toContain("已选第 1 格");
    expect(outputGrid?.className).toContain("grid-cols-3");
    expect(outputGrid?.querySelectorAll("button")).toHaveLength(9);
    expect(outputGrid?.textContent).toContain("1");
    expect(outputGrid?.textContent).toContain("9");
    expect(container.textContent).toContain("第 1 格");
  });

  it("3x3 分镜应把分镜元信息传给独立资源管理器", () => {
    const onSelectOutput = vi.fn();
    const outputs = Array.from({ length: 3 }, (_, index) => ({
      id: `output-storyboard-preview-${index + 1}`,
      refId: `img-storyboard-preview-${index + 1}`,
      taskId: "task-storyboard-preview-1",
      url: `https://example.com/storyboard-preview-${index + 1}.png`,
      prompt: `分镜 ${index + 1}`,
      slotIndex: index + 1,
      slotLabel: [`刘备亮相`, `曹操压迫感`, `诸葛亮谋局`][index],
      slotPrompt: `第 ${index + 1} 格完整提示词`,
      createdAt: index + 1,
    }));

    const { container } = renderComponent({
      tasks: [
        {
          id: "task-storyboard-preview-1",
          mode: "generate",
          status: "complete",
          prompt: "三国主要人物分镜",
          rawText: "@分镜 生成 三国主要人物分镜",
          expectedCount: 3,
          outputIds: outputs.map((output) => output.id),
          layoutHint: "storyboard_3x3",
          storyboardSlots: outputs.map((output, index) => ({
            slotId: `storyboard-slot-${index + 1}`,
            slotIndex: index + 1,
            label: output.slotLabel,
            prompt: output.slotPrompt,
          })),
          createdAt: 1,
        },
      ],
      outputs,
      selectedOutputId: outputs[0]?.id,
      onSelectOutput,
    });

    const openButton = container.querySelector(
      '[data-testid="image-task-viewer-open-image"]',
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockOpenResourceManager).toHaveBeenCalledWith(
      expect.objectContaining({
        initialIndex: 0,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "output-storyboard-preview-1",
            title: "刘备亮相",
            metadata: expect.objectContaining({
              slotLabel: "刘备亮相",
              prompt: "第 1 格完整提示词",
            }),
            sourceContext: expect.objectContaining({
              kind: "image_task",
              taskId: "task-storyboard-preview-1",
              outputId: "output-storyboard-preview-1",
            }),
          }),
          expect.objectContaining({
            id: "output-storyboard-preview-2",
            title: "曹操压迫感",
          }),
        ]),
      }),
    );
    expect(onSelectOutput).not.toHaveBeenCalled();
  });

  it("运行中的 3x3 分镜任务应先渲染 9 个固定槽位", () => {
    const outputs = [
      {
        id: "output-storyboard-running-1",
        refId: "img-storyboard-running-1",
        taskId: "task-storyboard-running-1",
        url: "https://example.com/storyboard-running-1.png",
        prompt: "分镜 1",
        createdAt: 1,
      },
      {
        id: "output-storyboard-running-2",
        refId: "img-storyboard-running-2",
        taskId: "task-storyboard-running-1",
        url: "https://example.com/storyboard-running-2.png",
        prompt: "分镜 2",
        createdAt: 2,
      },
    ];

    const { container } = renderComponent({
      tasks: [
        {
          id: "task-storyboard-running-1",
          mode: "generate",
          status: "running",
          prompt: "三国主要人物分镜",
          rawText: "@分镜 生成 三国主要人物分镜",
          expectedCount: 9,
          outputIds: outputs.map((output) => output.id),
          layoutHint: "storyboard_3x3",
          createdAt: 1,
        },
      ],
      outputs,
      selectedOutputId: outputs[0]?.id,
    });

    const outputGrid = container.querySelector(
      '[data-testid="image-task-viewer-output-grid"]',
    ) as HTMLDivElement | null;

    expect(outputGrid?.className).toContain("grid-cols-3");
    expect(outputGrid?.querySelectorAll("button")).toHaveLength(9);
    expect(container.textContent).toContain("2 / 9 张结果");
    expect(container.textContent).toContain("等待生成");
  });

  it("修图任务应优先展示来源图输出与修图语义", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-source-1",
          mode: "generate",
          status: "complete",
          prompt: "原始海报",
          rawText: "@配图 原始海报",
          expectedCount: 1,
          outputIds: ["output-source-1"],
          createdAt: 1,
        },
        {
          id: "task-edit-1",
          mode: "edit",
          status: "complete",
          prompt: "去掉背景里的路人，保留主体人物",
          rawText: "@修图 去掉背景里的路人，保留主体人物",
          expectedCount: 1,
          outputIds: ["output-edit-1"],
          targetOutputId: "output-source-1",
          targetOutputRefId: "img-source-1",
          sourceImageRef: "img-source-1",
          sourceImageCount: 1,
          createdAt: 2,
        },
      ],
      outputs: [
        {
          id: "output-source-1",
          refId: "img-source-1",
          taskId: "task-source-1",
          url: "https://example.com/source.png",
          prompt: "原始海报",
          createdAt: 1,
        },
        {
          id: "output-edit-1",
          refId: "img-edit-1",
          taskId: "task-edit-1",
          url: "https://example.com/edited.png",
          prompt: "移除路人后的海报",
          createdAt: 2,
          parentOutputId: "output-source-1",
        },
      ],
      selectedOutputId: "output-edit-1",
    });

    const sourcePanel = container.querySelector(
      '[data-testid="image-task-viewer-source"]',
    );
    expect(container.textContent).toContain("Image Editing");
    expect(container.textContent).toContain("已修图");
    expect(sourcePanel?.textContent).toContain("来源图");
    expect(sourcePanel?.textContent).toContain("原始海报");
    expect(sourcePanel?.textContent).toContain("img-source-1");
    expect(
      sourcePanel?.querySelector('img[src="https://example.com/source.png"]'),
    ).toBeTruthy();
  });

  it("来源图加载失败时应展示来源图兜底文案", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-source-1",
          mode: "generate",
          status: "complete",
          prompt: "原始海报",
          rawText: "@配图 原始海报",
          expectedCount: 1,
          outputIds: ["output-source-1"],
          createdAt: 1,
        },
        {
          id: "task-edit-1",
          mode: "edit",
          status: "complete",
          prompt: "去掉背景里的路人，保留主体人物",
          rawText: "@修图 去掉背景里的路人，保留主体人物",
          expectedCount: 1,
          outputIds: ["output-edit-1"],
          targetOutputId: "output-source-1",
          targetOutputRefId: "img-source-1",
          sourceImageRef: "img-source-1",
          sourceImageCount: 1,
          createdAt: 2,
        },
      ],
      outputs: [
        {
          id: "output-source-1",
          refId: "img-source-1",
          taskId: "task-source-1",
          url: "https://example.com/source.png",
          prompt: "原始海报",
          createdAt: 1,
        },
        {
          id: "output-edit-1",
          refId: "img-edit-1",
          taskId: "task-edit-1",
          url: "https://example.com/edited.png",
          prompt: "移除路人后的海报",
          createdAt: 2,
          parentOutputId: "output-source-1",
        },
      ],
      selectedOutputId: "output-edit-1",
    });

    const sourceImage = container.querySelector(
      '[data-testid="image-task-viewer-source-image"]',
    );
    expect(sourceImage).toBeTruthy();

    act(() => {
      sourceImage?.dispatchEvent(new Event("error"));
    });

    expect(container.textContent).toContain("来源图暂时无法显示");
  });

  it("重绘任务应优先展示参考图输出与重绘语义", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-source-variation",
          mode: "generate",
          status: "complete",
          prompt: "原始海报",
          rawText: "@配图 原始海报",
          expectedCount: 1,
          outputIds: ["output-source-variation"],
          createdAt: 1,
        },
        {
          id: "task-variation-1",
          mode: "variation",
          status: "complete",
          prompt: "更偏插画风，保留主体构图",
          rawText: "@重绘 更偏插画风，保留主体构图",
          expectedCount: 1,
          outputIds: ["output-variation-1"],
          targetOutputId: "output-source-variation",
          targetOutputRefId: "img-source-variation",
          sourceImageRef: "img-source-variation",
          sourceImageCount: 1,
          createdAt: 2,
        },
      ],
      outputs: [
        {
          id: "output-source-variation",
          refId: "img-source-variation",
          taskId: "task-source-variation",
          url: "https://example.com/source-variation.png",
          prompt: "原始海报",
          createdAt: 1,
        },
        {
          id: "output-variation-1",
          refId: "img-variation-1",
          taskId: "task-variation-1",
          url: "https://example.com/variation.png",
          prompt: "插画风海报",
          createdAt: 2,
          parentOutputId: "output-source-variation",
        },
      ],
      selectedOutputId: "output-variation-1",
    });

    const sourcePanel = container.querySelector(
      '[data-testid="image-task-viewer-source"]',
    );
    expect(container.textContent).toContain("Image Redraw");
    expect(container.textContent).toContain("已重绘");
    expect(sourcePanel?.textContent).toContain("参考图");
    expect(sourcePanel?.textContent).toContain("原始海报");
    expect(sourcePanel?.textContent).toContain("img-source-variation");
    expect(
      sourcePanel?.querySelector(
        'img[src="https://example.com/source-variation.png"]',
      ),
    ).toBeTruthy();
  });

  it("点击继续修图按钮应把当前结果种回输入命令", () => {
    const onSeedFollowUpCommand = vi.fn();
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-edit-follow-up",
          mode: "edit",
          status: "complete",
          prompt: "去掉背景里的路人，保留主体人物",
          rawText: "@修图 去掉背景里的路人，保留主体人物",
          expectedCount: 1,
          outputIds: ["output-edit-follow-up"],
          createdAt: 2,
        },
      ],
      outputs: [
        {
          id: "output-edit-follow-up",
          refId: "img-edit-1",
          taskId: "task-edit-follow-up",
          url: "https://example.com/edited.png",
          prompt: "移除路人后的海报",
          createdAt: 2,
        },
      ],
      selectedOutputId: "output-edit-follow-up",
      onSeedFollowUpCommand,
    });

    const button = container.querySelector(
      '[data-testid="image-task-viewer-action-follow-up"]',
    );
    expect(button?.textContent).toContain("继续修图");

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSeedFollowUpCommand).toHaveBeenCalledWith(
      "@修图 #img-edit-1 去掉背景里的路人，保留主体人物",
    );
  });

  it("点击继续重绘按钮应把当前结果种回重绘命令", () => {
    const onSeedFollowUpCommand = vi.fn();
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-variation-follow-up",
          mode: "variation",
          status: "complete",
          prompt: "更偏插画风，保留主体构图",
          rawText: "@重绘 更偏插画风，保留主体构图",
          expectedCount: 1,
          outputIds: ["output-variation-follow-up"],
          createdAt: 2,
        },
      ],
      outputs: [
        {
          id: "output-variation-follow-up",
          refId: "img-variation-1",
          taskId: "task-variation-follow-up",
          url: "https://example.com/variation-follow-up.png",
          prompt: "插画风海报",
          createdAt: 2,
        },
      ],
      selectedOutputId: "output-variation-follow-up",
      onSeedFollowUpCommand,
    });

    const button = container.querySelector(
      '[data-testid="image-task-viewer-action-follow-up"]',
    );
    expect(button?.textContent).toContain("继续重绘");

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSeedFollowUpCommand).toHaveBeenCalledWith(
      "@重绘 #img-variation-1 更偏插画风，保留主体构图",
    );
  });

  it("应渲染保存和应用动作，并透传回调", () => {
    const onSaveSelectedToLibrary = vi.fn();
    const onApplySelectedOutput = vi.fn();
    const { container } = renderComponent({
      onSaveSelectedToLibrary,
      onApplySelectedOutput,
      applySelectedOutputLabel: "应用到文稿",
    });

    const saveButton = container.querySelector(
      '[data-testid="image-task-viewer-action-save"]',
    );
    const applyButton = container.querySelector(
      '[data-testid="image-task-viewer-action-apply"]',
    );

    expect(saveButton?.textContent).toContain("保存到素材库");
    expect(applyButton?.textContent).toContain("应用到文稿");

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveSelectedToLibrary).toHaveBeenCalledTimes(1);
    expect(onApplySelectedOutput).toHaveBeenCalledTimes(1);
  });
});
