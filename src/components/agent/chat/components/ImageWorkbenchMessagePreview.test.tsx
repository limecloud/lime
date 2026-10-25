import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { MessageImageWorkbenchPreview } from "../types";
import { ImageWorkbenchMessagePreview } from "./ImageWorkbenchMessagePreview";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const IMAGE_WORKBENCH_TASK_ACTION_EVENT = "lime:image-workbench-task-action";
const IMAGE_WORKBENCH_FOCUS_EVENT = "lime:image-workbench-focus";

function renderPreview(
  preview: MessageImageWorkbenchPreview,
  props?: Partial<
    Omit<ComponentProps<typeof ImageWorkbenchMessagePreview>, "preview">
  >,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ImageWorkbenchMessagePreview preview={preview} {...props} />);
  });

  mountedRoots.push({ root, container });
  return { container };
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("ImageWorkbenchMessagePreview", () => {
  it("renders a complete image with the lightweight tool strip and no task chrome", () => {
    const { container } = renderPreview({
      taskId: "image-preview-complete",
      prompt: "",
      mode: "generate",
      status: "complete",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      imageCount: 1,
      caption: "搞定，已生成这张图。",
      runtimeContract: {
        model: "fal-ai/nano-banana-pro",
      },
    });

    expect(container.textContent).toContain("Image Generation");
    expect(container.textContent).toContain("Nanobanana Pro");
    expect(container.textContent).toContain("搞定，已生成这张图。");
    expect(
      container
        .querySelector(
          '[data-testid="image-workbench-message-preview-toolbar-image-preview-complete"]',
        )
        ?.className.toString(),
    ).toContain("bg-[#eef0ec]");
    expect(
      container
        .querySelector(
          '[data-testid="image-workbench-message-preview-toolbar-image-preview-complete"]',
        )
        ?.getAttribute("data-model-id"),
    ).toBe("fal-ai/nano-banana-pro");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aW1hZ2U=",
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain(
      "No prompt provided for this task.",
    );
    expect(container.textContent).not.toContain("Generated");
    expect(container.textContent).not.toContain(
      "The image result is complete. Open the right panel to review and use it.",
    );
    expect(container.textContent).not.toContain("Result synced");
    expect(container.textContent).not.toContain("当前任务未提供提示词");
  });



  it("does not invent a completion caption when the preview has none", () => {
    const { container } = renderPreview({
      taskId: "image-preview-complete-fallback",
      prompt: "从花城汇看广州塔的春天照片",
      mode: "generate",
      status: "complete",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      imageCount: 1,
      runtimeContract: {
        model: "fal-ai/nano-banana-pro",
      },
    });

    expect(container.textContent).toContain("Image Generation");
    expect(container.textContent).toContain("Nanobanana Pro");
    expect(container.textContent).not.toContain("搞定");
    expect(container.textContent).not.toContain("从花城汇看广州塔的春天照片");
  });

  it("does not invent completion caption once a running preview already has an image", () => {
    const { container } = renderPreview({
      taskId: "image-preview-running-with-image",
      prompt: "用 Agnes 生成一张深圳夏天午后的城市照片",
      mode: "generate",
      status: "running",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      imageCount: 1,
      expectedImageCount: 1,
      runtimeContract: {
        model: "agnes-image-2.1-flash",
      },
    });

    expect(container.textContent).toContain("Image Generation");
    expect(container.textContent).toContain("Agnes Image 2.1 Flash");
    expect(container.textContent).not.toContain("搞定");
    expect(container.textContent).not.toContain("深圳夏天");
  });

  it("keeps explicit completion captions from the backend", () => {
    const { container } = renderPreview({
      taskId: "image-preview-polluted-caption",
      prompt: "用 Agnes Generate一张深圳夏day午后的城市照片，真实摄影Style",
      mode: "generate",
      status: "complete",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      imageCount: 1,
      caption: "搞定，深圳夏day午后的城市照片，真实摄影Style 已经做好了。",
      runtimeContract: {
        model: "agnes-image-2.1-flash",
      },
    });

    expect(container.textContent).toContain(
      "搞定，深圳夏day午后的城市照片，真实摄影Style 已经做好了。",
    );
  });

  it("does not show completion caption while the image task is still running", () => {
    const { container } = renderPreview({
      taskId: "image-preview-running-caption",
      prompt: "从花城汇看广州塔的春天照片",
      mode: "generate",
      status: "running",
      imageCount: 1,
      caption: "完成了，广州塔春天照片已经生成。",
      runtimeContract: {
        model: "fal-ai/nano-banana-pro",
      },
    });

    expect(container.textContent).toContain("Image Generation");
    expect(container.textContent).toContain("Nanobanana Pro");
    expect(container.textContent).toContain("Generating image");
    expect(container.textContent).not.toContain("完成了");
  });

  it("does not open the right viewer by default when the chat preview is clicked", () => {
    const { container } = renderPreview({
      taskId: "image-preview-readonly",
      prompt: "从花城汇看广州塔的春天照片",
      mode: "generate",
      status: "complete",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      imageCount: 1,
      projectId: "project-1",
      contentId: "content-1",
    });

    const focusListener = vi.fn();
    window.addEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, focusListener);

    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-image-preview-readonly"]',
    ) as HTMLDivElement | null;
    const media = container.querySelector(
      '[data-testid="image-workbench-message-preview-single-media-image-preview-readonly"]',
    ) as HTMLDivElement | null;

    act(() => {
      previewCard?.click();
      media?.click();
    });

    expect(focusListener).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();

    window.removeEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, focusListener);
  });

  it("hides legacy task-card status and source chrome in chat preview", () => {
    const { container } = renderPreview({
      taskId: "image-preview-variation",
      prompt: "Create a softer visual direction",
      mode: "variation",
      status: "partial",
      imageCount: 2,
      expectedImageCount: 4,
      sourceImageCount: 2,
    });

    expect(container.textContent).toContain("Image Redraw");
    expect(container.textContent).toContain("Image is temporarily unavailable");
    expect(container.textContent).not.toContain("2/4 images");
    expect(container.textContent).not.toContain("Partially complete");
    expect(container.textContent).not.toContain(
      "Returned 2 / 4 variation result item(s); the remaining results are not complete.",
    );
    expect(container.textContent).not.toContain(
      "Reference images: Attached 2 reference image(s).",
    );
    expect(container.textContent).not.toContain("参考图");
    expect(container.textContent).not.toContain("部分完成");
  });

  it("does not render image command workflow steps inside the chat preview", () => {
    const { container } = renderPreview({
      taskId: "image-preview-workflow",
      prompt: "Generate two lime product images",
      mode: "generate",
      status: "running",
      expectedImageCount: 2,
      workflowRun: {
        runId: "image-command-run-turn-1",
        workflowKey: "image_command_workflow",
        title: "Lime product images",
        summary: "Generate two lime product images",
        requestedCount: 2,
        status: "queued",
        steps: [
          {
            id: "intent",
            title: "Parse image request",
            status: "succeeded",
          },
          {
            id: "generate",
            title: "Generate images",
            status: "running",
          },
        ],
        branches: [
          {
            branchId: "image-command-run-turn-1:branch:white-bg",
            title: "White background",
            prompt: "White background lime product image",
            status: "queued",
          },
          {
            branchId: "image-command-run-turn-1:branch:gray-bg",
            title: "Gray background",
            prompt: "Gray background lime product image",
            status: "queued",
          },
        ],
        nextActions: [{ type: "open_workbench" }],
      },
    });

    const workflow = container.querySelector(
      '[data-testid="image-workbench-message-preview-workflow-image-preview-workflow"]',
    );

    expect(workflow).toBeNull();
    expect(container.textContent).toContain("Image Generation");
    expect(container.textContent).not.toContain("Lime product images");
    expect(container.textContent).not.toContain("2 steps");
    expect(container.textContent).not.toContain("Parse image request");
    expect(container.textContent).not.toContain("White background");
  });

  it("failed preview exposes a dedicated retry action without replacing the open card", () => {
    const { container } = renderPreview({
      taskId: "image-preview-failed",
      prompt: "Create a lime poster",
      mode: "generate",
      status: "failed",
      projectId: "project-1",
      contentId: "content-1",
      statusMessage: "Provider timeout",
    });

    let actionDetail: Record<string, unknown> | null = null;
    const handleAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      actionDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(IMAGE_WORKBENCH_TASK_ACTION_EVENT, handleAction);

    const openCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-image-preview-failed"]',
    ) as HTMLDivElement | null;
    const retryButton = container.querySelector(
      '[data-testid="image-workbench-message-preview-action-image-preview-failed-retry"]',
    ) as HTMLButtonElement | null;

    expect(openCard).not.toBeNull();
    expect(retryButton?.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("Provider timeout");

    act(() => {
      retryButton?.click();
    });

    expect(actionDetail).toEqual({
      action: "retry",
      taskId: "image-preview-failed",
      projectId: "project-1",
      contentId: "content-1",
    });

    window.removeEventListener(IMAGE_WORKBENCH_TASK_ACTION_EVENT, handleAction);
  });

  it("cancelled preview also exposes retry unless the task is marked non-retryable", () => {
    const { container } = renderPreview({
      taskId: "image-preview-cancelled",
      prompt: "Create a lime poster",
      mode: "generate",
      status: "cancelled",
      projectId: "project-1",
      contentId: "content-1",
    });

    let actionDetail: Record<string, unknown> | null = null;
    const handleAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      actionDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(IMAGE_WORKBENCH_TASK_ACTION_EVENT, handleAction);

    const retryButton = container.querySelector(
      '[data-testid="image-workbench-message-preview-action-image-preview-cancelled-retry"]',
    ) as HTMLButtonElement | null;

    expect(retryButton?.textContent).toContain("Retry");

    act(() => {
      retryButton?.click();
    });

    expect(actionDetail).toEqual({
      action: "retry",
      taskId: "image-preview-cancelled",
      projectId: "project-1",
      contentId: "content-1",
    });

    window.removeEventListener(IMAGE_WORKBENCH_TASK_ACTION_EVENT, handleAction);
  });

  it("does not expose retry when task preview explicitly marks it non-retryable", () => {
    const { container } = renderPreview({
      taskId: "image-preview-not-retryable",
      prompt: "Create a lime poster",
      mode: "generate",
      status: "failed",
      retryable: false,
    });

    expect(
      container.querySelector(
        '[data-testid="image-workbench-message-preview-action-image-preview-not-retryable-retry"]',
      ),
    ).toBeNull();
  });

  it("passes the clicked grid image so the viewer does not fall back to the first output", () => {
    const onOpen = vi.fn();
    const { container } = renderPreview(
      {
        taskId: "image-preview-storyboard",
        prompt: "九张章节配图",
        mode: "generate",
        status: "complete",
        imageUrl: "https://example.com/chapter-1.png",
        previewImages: [
          "https://example.com/chapter-1.png",
          "https://example.com/chapter-2.png",
          "https://example.com/chapter-3.png",
        ],
        imageCount: 3,
      },
      { onOpen },
    );

    const secondImageButton = container.querySelector(
      '[data-testid="image-workbench-message-preview-media-image-preview-storyboard-2"]',
    ) as HTMLButtonElement | null;

    act(() => {
      secondImageButton?.click();
    });

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "image-preview-storyboard",
      }),
      {
        imageUrl: "https://example.com/chapter-2.png",
        imageIndex: 1,
      },
    );
  });
});
