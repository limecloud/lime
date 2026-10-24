import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

const onOpenArtifact = vi.fn();

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
    selectedTaskId: "task-1",
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
    onOpenArtifact,
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

beforeEach(async () => {
  await changeLimeLocale("zh-CN");
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

  it("点击大图应交给标准 Artifact 预览并保留任务与会话身份", () => {
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

    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "广州塔主视觉",
        meta: expect.objectContaining({
          source: "task",
          sourceRef: "output-1",
          contentKind: "image",
          renderMode: "media",
          previewUrl: "https://example.com/image-1.png",
          taskId: "task-1",
          outputId: "output-1",
          projectId: "project-1",
          contentId: "content-1",
          threadId: "thread-1",
        }),
      }),
    );
  });

  it("普通图片查看器不展示运行合同、策略和 provider/model 审计字段", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-runtime-model-1",
          mode: "generate",
          status: "complete",
          prompt: "最新模型青柠主视觉",
          rawText: "@配图 最新模型青柠主视觉",
          expectedCount: 1,
          outputIds: ["output-runtime-model-1"],
          createdAt: 1,
          runtimeContract: {
            providerId: "fal",
            model: "fal-ai/nano-banana-pro-v2",
            contractKey: "image_generation",
            routingOutcome: "accepted",
            limecorePolicyEvaluationStatus: "input_gap",
            limecorePolicyMissingInputs: ["subject"],
          },
        },
      ],
      outputs: [
        {
          id: "output-runtime-model-1",
          refId: "img-runtime-model-1",
          taskId: "task-runtime-model-1",
          url: "https://example.com/runtime-model.png",
          prompt: "最新模型青柠主视觉",
          createdAt: 1,
        },
      ],
      selectedTaskId: "task-runtime-model-1",
      selectedOutputId: "output-runtime-model-1",
    });

    expect(
      container.querySelector(
        '[data-testid="image-task-viewer-runtime-contract"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="image-task-viewer-runtime-contract-registry"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="image-task-viewer-runtime-contract-policy"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("运行合同");
    expect(container.textContent).not.toContain("LimeCore 策略");
    expect(container.textContent).not.toContain("fal");
    expect(container.textContent).not.toContain("fal-ai/nano-banana-pro-v2");

    const openButton = container.querySelector(
      '[data-testid="image-task-viewer-open-image"]',
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          sourceRef: "output-runtime-model-1",
          previewUrl: "https://example.com/runtime-model.png",
        }),
      }),
    );
    expect(onOpenArtifact.mock.calls[0]?.[0].meta).not.toHaveProperty(
      "providerName",
    );
    expect(onOpenArtifact.mock.calls[0]?.[0].meta).not.toHaveProperty(
      "modelName",
    );
  });

  it("右侧图片查看器不展示 workflow 审计过程", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-workflow-hidden",
          mode: "generate",
          status: "running",
          prompt: "生成一张深圳夏天的图",
          rawText: "@配图 生成一张深圳夏天的图",
          expectedCount: 1,
          outputIds: [],
          createdAt: 1,
          workflowRun: {
            runId: "run-image-workflow-hidden",
            workflowKey: "image_command_workflow",
            title: "图片生成工作流",
            summary: "图片工作流正在运行",
            requestedCount: 1,
            status: "running",
            steps: [
              { id: "intent", title: "解析图片需求", status: "succeeded" },
              { id: "generate", title: "生成图片", status: "running" },
            ],
            branches: [
              {
                branchId: "branch-1",
                title: "深圳夏天",
                prompt: "深圳夏天",
                status: "running",
              },
            ],
            nextActions: [],
          },
        },
      ],
      outputs: [],
      selectedTaskId: "task-workflow-hidden",
      selectedOutputId: null,
    });

    expect(
      container.querySelector('[data-testid="image-task-viewer-workflow"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("图片生成工作流");
    expect(container.textContent).not.toContain("解析图片需求");
    expect(container.textContent).not.toContain("生成图片");
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

  it("选中无结果的失败任务时不回退展示上一张成功图", () => {
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-failed-2",
          mode: "generate",
          status: "error",
          prompt: "青柠极简插画",
          rawText: "@配图 青柠极简插画",
          expectedCount: 1,
          outputIds: [],
          createdAt: 2,
          failureMessage:
            '默认图片服务调用失败: Fal HTTP 403: {"detail":"User is locked."}',
        },
        {
          id: "task-success-1",
          mode: "generate",
          status: "complete",
          prompt: "广州塔春天照片",
          rawText: "@配图 广州塔春天照片",
          expectedCount: 1,
          outputIds: ["output-success-1"],
          createdAt: 1,
        },
      ],
      outputs: [
        {
          id: "output-success-1",
          refId: "img-success-1",
          taskId: "task-success-1",
          url: "https://example.com/success.png",
          prompt: "广州塔春天照片",
          createdAt: 1,
        },
      ],
      selectedTaskId: "task-failed-2",
      selectedOutputId: null,
    });

    expect(container.textContent).toContain("青柠极简插画");
    expect(container.textContent).toContain("生成失败");
    expect(container.textContent).toContain("这次生成没有拿到可用图片结果。");
    expect(container.textContent).not.toContain("广州塔春天照片");
    expect(container.textContent).not.toContain("Fal HTTP 403");
    expect(
      container.querySelector('[data-testid="image-task-viewer-open-image"]'),
    ).toBeNull();
  });

  it("失败或取消任务应显示重试动作并透传当前任务 ID", () => {
    const onRetryTask = vi.fn();
    const { container } = renderComponent({
      tasks: [
        {
          id: "task-failed-retry",
          mode: "generate",
          status: "error",
          prompt: "青柠极简插画",
          rawText: "@配图 青柠极简插画",
          expectedCount: 1,
          outputIds: [],
          createdAt: 2,
        },
      ],
      outputs: [],
      selectedTaskId: "task-failed-retry",
      selectedOutputId: null,
      onRetryTask,
    });

    const retryButton = container.querySelector(
      '[data-testid="image-task-viewer-action-retry"]',
    );
    expect(retryButton?.textContent).toContain("重试");

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRetryTask).toHaveBeenCalledWith("task-failed-retry");
  });

  it("3x3 分镜应仅预览所选输出并保留分镜信息", () => {
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

    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "刘备亮相",
        meta: expect.objectContaining({
          sourceRef: "output-storyboard-preview-1",
          previewUrl: "https://example.com/storyboard-preview-1.png",
          taskId: "task-storyboard-preview-1",
          outputId: "output-storyboard-preview-1",
          prompt: "第 1 格完整提示词",
          slotLabel: "刘备亮相",
        }),
      }),
    );
    expect(onSelectOutput).not.toHaveBeenCalled();
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

  it("应保留应用动作且不再提供资源入库", () => {
    const onApplySelectedOutput = vi.fn();
    const { container } = renderComponent({
      onApplySelectedOutput,
      applySelectedOutputLabel: "应用到文稿",
    });

    const saveButton = container.querySelector(
      '[data-testid="image-task-viewer-action-save"]',
    );
    const applyButton = container.querySelector(
      '[data-testid="image-task-viewer-action-apply"]',
    );

    expect(saveButton).toBeNull();
    expect(applyButton?.textContent).toContain("应用到文稿");

    act(() => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onApplySelectedOutput).toHaveBeenCalledTimes(1);
  });
});
