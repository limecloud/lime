import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  ackCanvasImageInsertRequest,
  getPendingCanvasImageInsertRequests,
} from "@/lib/canvasImageInsertBus";
import { createInitialSessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import {
  type HookProps,
  createParsedCommand,
  renderCommandActionHook,
  renderHook,
  toast,
} from "./useWorkspaceImageWorkbenchActionRuntime.testFixtures";

describe("useWorkspaceImageWorkbenchActionRuntime document apply", () => {
  function clearPendingInsertRequests() {
    getPendingCanvasImageInsertRequests().forEach((request) => {
      ackCanvasImageInsertRequest(request.requestId);
    });
  }

  it("文稿插图任务应把 document-inline slot 信息写入 Agent launch 上下文", async () => {
    const submitImageWorkbenchAgentCommand = vi.fn().mockResolvedValue(true);
    const { render, getValue } = renderCommandActionHook({
      submitImageWorkbenchAgentCommand,
    });

    await render();

    await act(async () => {
      await getValue().handleImageWorkbenchCommand({
        rawText: "@配图 生成 城市夜景主视觉",
        parsedCommand: createParsedCommand(),
        images: [],
        applyTarget: {
          kind: "canvas-insert",
          canvasType: "document",
          anchorHint: "section_end",
          sectionTitle: "核心观点",
          anchorText: "这里是核心观点段落。",
          actionLabel: "插入文稿",
          dispatchLabel: "已切回文稿，正在插入图片",
        },
      });
    });

    expect(submitImageWorkbenchAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: expect.objectContaining({
          image_task: expect.objectContaining({
            usage: "document-inline",
            slot_id: expect.stringMatching(/^document-image-slot-/),
            anchor_hint: "section_end",
            anchor_section_title: "核心观点",
            anchor_text: "这里是核心观点段落。",
          }),
        }),
      }),
    );
  });

  it("应用图片结果时应只关闭图片工作台并派发插入，不主动切换布局", async () => {
    clearPendingInsertRequests();
    const updateCurrentImageWorkbenchState = vi.fn();
    const currentImageWorkbenchState: HookProps["currentImageWorkbenchState"] =
      {
        ...createInitialSessionImageWorkbenchState(),
        selectedOutputId: "task-image-1:output:1",
        outputs: [
          {
            id: "task-image-1:output:1",
            taskId: "task-image-1",
            hookImageId: "task-image-1:hook:1",
            refId: "img-2",
            url: "https://example.com/image-2.png",
            prompt: "原始图片",
            createdAt: Date.now(),
            providerName: "fal",
            modelName: "fal-ai/nano-banana-pro",
            size: "1024x1024",
            parentOutputId: null,
            applyTarget: {
              kind: "canvas-insert" as const,
              canvasType: "document" as const,
              anchorHint: "section_end" as const,
              slotId: "hero",
              sectionTitle: "核心观点",
              anchorText: "这里是核心观点段落。",
              actionLabel: "插入文稿",
              dispatchLabel: "已切回文稿，正在插入图片",
            },
          },
        ],
      };
    const { render, getValue } = renderHook({
      currentImageWorkbenchState,
      updateCurrentImageWorkbenchState,
    });

    await render();

    act(() => {
      getValue().handleApplySelectedImageWorkbenchOutput();
    });

    expect(updateCurrentImageWorkbenchState).toHaveBeenCalledTimes(1);
    expect(updateCurrentImageWorkbenchState).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(getPendingCanvasImageInsertRequests()).toContainEqual(
      expect.objectContaining({
        projectId: "project-1",
        contentId: null,
        canvasType: "document",
        anchorHint: "section_end",
        taskId: "task-image-1",
        slotId: "hero",
        sectionTitle: "核心观点",
        anchorText: "这里是核心观点段落。",
        source: "manual",
        image: expect.objectContaining({
          contentUrl: "https://example.com/image-2.png",
        }),
      }),
    );
    expect(toast.info).toHaveBeenCalledWith("已切回文稿，正在插入图片");
    expect(toast.error).not.toHaveBeenCalled();
    clearPendingInsertRequests();
  });

  it("继续修图 follow-up 应回填输入框并使用中性提示文案", async () => {
    const setInput = vi.fn();
    const { render, getValue } = renderHook({
      setInput,
    });

    await render();

    act(() => {
      getValue().handleSeedImageWorkbenchFollowUp("@修图 #img-2 去掉角标");
    });

    expect(setInput).toHaveBeenCalledWith("@修图 #img-2 去掉角标");
    expect(toast.info).toHaveBeenCalledWith("已在输入框填入图片命令");
  });

  it("图片动作提示应跟随当前语言资源，而不是组件内硬编码中文", async () => {
    await changeLimeLocale("en-US");
    const setInput = vi.fn();
    const { render, getValue } = renderHook({
      setInput,
    });

    await render();

    act(() => {
      getValue().handleSeedImageWorkbenchFollowUp("@edit #img-2 remove logo");
    });

    expect(setInput).toHaveBeenCalledWith("@edit #img-2 remove logo");
    expect(toast.info).toHaveBeenCalledWith("Image command added to the input");
  });
});
