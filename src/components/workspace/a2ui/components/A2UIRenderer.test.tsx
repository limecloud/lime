import { afterEach, describe, expect, it, vi } from "vitest";
import { A2UIRenderer } from "./index";
import { TextRenderer } from "../catalog/basic/components/Text";
import { A2UI_RENDERER_TOKENS } from "../rendererTokens";
import {
  cleanupMountedRoots,
  clickButtonByText,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

setupReactActEnvironment();

describe("A2UIRenderer", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("应使用统一容器与提交按钮样式，并支持禁用提交", () => {
    const submitSpy = vi.fn();
    const { container } = mountHarness(
      A2UIRenderer,
      {
        response: {
          id: "demo",
          root: "root",
          thinking: "这是推理提示",
          data: {},
          components: [
            {
              id: "content",
              component: "Text",
              text: "请选择开始方式",
              variant: "body",
            },
            {
              id: "root",
              component: "Column",
              children: ["content"],
              gap: 12,
              align: "stretch",
            },
          ],
          submitAction: {
            label: "开始处理",
            action: { name: "submit" },
          },
        },
        submitDisabled: true,
        onSubmit: submitSpy,
      },
      mountedRoots,
    );

    const root = container.querySelector(
      ".a2ui-container",
    ) as HTMLDivElement | null;
    expect(root?.className).toContain("space-y-4");
    expect(container.textContent).toContain("这是推理提示");
    const submitButton = clickButtonByText(container, "开始处理");
    expect(submitButton?.className).toBe(A2UI_RENDERER_TOKENS.submitButton);
    expect(submitButton?.disabled).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("找不到根组件时应显示统一错误样式", () => {
    const { container } = mountHarness(
      A2UIRenderer,
      {
        response: {
          id: "missing-root",
          root: "unknown",
          data: {},
          components: [],
        },
      },
      mountedRoots,
    );

    const errorNode = container.querySelector("div");
    expect(errorNode?.className).toBe(A2UI_RENDERER_TOKENS.errorText);
    expect(container.textContent).toContain("错误：找不到根组件 unknown");
  });

  it("应渲染媒体、标签页与模态组件", async () => {
    const { container } = mountHarness(
      A2UIRenderer,
      {
        response: {
          id: "rich-surface",
          root: "root",
          data: {},
          components: [
            {
              id: "hero-image",
              component: "Image",
              url: "https://example.com/hero.png",
              variant: "mediumFeature",
            },
            {
              id: "status-icon",
              component: "Icon",
              name: "star",
            },
            {
              id: "video",
              component: "Video",
              url: "https://example.com/demo.mp4",
            },
            {
              id: "audio",
              component: "AudioPlayer",
              url: "https://example.com/demo.mp3",
              description: "语音摘要",
            },
            {
              id: "tab-content-a",
              component: "Text",
              text: "第一个标签页",
              variant: "body",
            },
            {
              id: "tab-content-b",
              component: "Text",
              text: "第二个标签页",
              variant: "body",
            },
            {
              id: "tabs",
              component: "Tabs",
              tabs: [
                { title: "概览", child: "tab-content-a" },
                { title: "详情", child: "tab-content-b" },
              ],
            },
            {
              id: "modal-trigger-text",
              component: "Text",
              text: "打开详情",
              variant: "body",
            },
            {
              id: "modal-trigger",
              component: "Button",
              child: "modal-trigger-text",
              action: { name: "open_modal" },
              variant: "primary",
            },
            {
              id: "modal-content",
              component: "Text",
              text: "弹窗内容",
              variant: "body",
            },
            {
              id: "modal",
              component: "Modal",
              trigger: "modal-trigger",
              content: "modal-content",
            },
            {
              id: "root",
              component: "Column",
              children: [
                "hero-image",
                "status-icon",
                "video",
                "audio",
                "tabs",
                "modal",
              ],
              gap: 12,
              align: "stretch",
            },
          ],
        },
      },
      mountedRoots,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/hero.png",
    );
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/demo.mp4",
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "https://example.com/demo.mp3",
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("第一个标签页");
    expect(container.textContent).not.toContain("第二个标签页");

    clickButtonByText(container, "详情");
    expect(container.textContent).toContain("第二个标签页");

    clickButtonByText(container, "打开详情");
    await flushEffects();
    expect(document.body.textContent).toContain("弹窗内容");
  });
});

describe("TextRenderer", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应使用统一文本 variant token", () => {
    const { container } = mountHarness(
      TextRenderer,
      {
        component: {
          id: "caption",
          component: "Text",
          text: "辅助说明",
          variant: "caption",
        },
        data: {},
      },
      mountedRoots,
    );

    const textNode = container.querySelector(".a2ui-text-block");
    expect(textNode?.className).toContain(
      A2UI_RENDERER_TOKENS.textVariants.caption,
    );
    expect(container.textContent).toContain("辅助说明");
  });

  it("检测到 markdown 语法时应渲染语义化内容而不是原始标记", () => {
    const { container } = mountHarness(
      TextRenderer,
      {
        component: {
          id: "markdown-text",
          component: "Text",
          text: "# 标题\n\n这是 **重点**。\n\n- 第一项\n- 第二项\n\n[查看说明](https://example.com)\n第一行  \n第二行",
          variant: "body",
        },
        data: {},
      },
      mountedRoots,
    );

    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelector("strong")?.textContent).toBe("重点");
    expect(
      Array.from(container.querySelectorAll("li")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["第一项", "第二项"]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).not.toContain("**重点**");
  });
});
