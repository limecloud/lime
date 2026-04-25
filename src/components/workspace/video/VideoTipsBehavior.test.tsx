import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptInput } from "./PromptInput";
import { VideoSidebar } from "./VideoSidebar";
import { VideoWorkspace } from "./VideoWorkspace";
import { createInitialVideoState } from "./types";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const mountedRoots: MountedRoot[] = [];

function getBodyText(): string {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string): Promise<HTMLButtonElement> {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null): Promise<void> {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("视频工作台 tips 收口", () => {
  beforeEach(() => {
    setupReactActEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("提示词输入区应默认隐藏解释文案，只在 hover tips 时展示", async () => {
    mountHarness(
      PromptInput,
      {
        state: createInitialVideoState(),
        onStateChange: vi.fn(),
        onGenerate: vi.fn(),
      },
      mountedRoots,
    );
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "先写主体、场景和运动方式，再补充光线、氛围或镜头语言",
    );
    expect(getBodyText()).not.toContain("按 Enter 直接生成");

    const promptTip = await hoverTip("提示词说明");
    expect(getBodyText()).toContain(
      "先写主体、场景和运动方式，再补充光线、氛围或镜头语言",
    );
    await leaveTip(promptTip);
    expect(getBodyText()).not.toContain(
      "先写主体、场景和运动方式，再补充光线、氛围或镜头语言",
    );

    const shortcutTip = await hoverTip("快捷键说明");
    expect(getBodyText()).toContain("按 Enter 直接生成，Shift + Enter 换行。");
    await leaveTip(shortcutTip);
    expect(getBodyText()).not.toContain("按 Enter 直接生成");
  });

  it("左侧参数栏应把说明文案和建议统一收到 tips", async () => {
    mountHarness(
      VideoSidebar,
      {
        state: createInitialVideoState(),
        providers: [],
        availableModels: [],
        onStateChange: vi.fn(),
      },
      mountedRoots,
    );
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "先确定模型，再补参考图和输出规格。这里保持轻量控制，主创作仍留在右侧画布。",
    );
    expect(getBodyText()).not.toContain(
      "需要复现某次结果时再固定种子；探索阶段保持随机即可。",
    );
    expect(getBodyText()).not.toContain(
      "提示词优先写清主体、场景、镜头运动和光线。",
    );

    const introTip = await hoverTip("生成参数说明");
    expect(getBodyText()).toContain(
      "先确定模型，再补参考图和输出规格。这里保持轻量控制，主创作仍留在右侧画布。",
    );
    await leaveTip(introTip);

    const helperTip = await hoverTip("提示词建议");
    expect(getBodyText()).toContain(
      "提示词优先写清主体、场景、镜头运动和光线。生成成功后，视频会自动同步到项目资料，便于后续复用。",
    );
    await leaveTip(helperTip);
  });

  it("主工作台应把首屏介绍和摘要卡 hint 收到 tips", async () => {
    mountHarness(
      VideoWorkspace,
      {
        state: createInitialVideoState(),
        onStateChange: vi.fn(),
        projectId: null,
      },
      mountedRoots,
    );
    await flushEffects(6);

    expect(getBodyText()).not.toContain(
      "用一句清晰的场景描述启动视频生成，再逐步补充镜头运动、情绪和画面锚点。",
    );
    expect(getBodyText()).not.toContain("请先在左侧选择视频服务");

    const workspaceTip = await hoverTip("视频创作说明");
    expect(getBodyText()).toContain(
      "用一句清晰的场景描述启动视频生成，再逐步补充镜头运动、情绪和画面锚点。先让结构成立，再慢慢叠加参考图与参数约束。",
    );
    await leaveTip(workspaceTip);

    const statTip = await hoverTip("当前模型说明");
    expect(getBodyText()).toContain("请先在左侧选择视频服务");
    await leaveTip(statTip);
  });
});
