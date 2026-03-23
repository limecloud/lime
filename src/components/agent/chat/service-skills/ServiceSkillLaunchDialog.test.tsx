import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSkillLaunchDialog } from "./ServiceSkillLaunchDialog";
import type { ServiceSkillHomeItem } from "./types";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="service-skill-dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const MOCK_SKILL: ServiceSkillHomeItem = {
  id: "short-video-script-replication",
  title: "复制短视频脚本",
  summary: "围绕参考视频的结构和节奏，输出一版可继续加工的脚本。",
  category: "视频创作",
  outputHint: "脚本大纲 + 镜头节奏",
  source: "cloud_catalog",
  runnerType: "instant",
  defaultExecutorBinding: "agent_turn",
  executionLocation: "client_default",
  themeTarget: "video",
  version: "seed-v1",
  slotSchema: [
    {
      key: "reference_video",
      label: "参考视频链接/素材",
      type: "url",
      required: true,
      placeholder: "输入视频链接",
    },
    {
      key: "platform",
      label: "发布平台",
      type: "platform",
      required: true,
      defaultValue: "douyin",
      placeholder: "选择平台",
      options: [{ value: "douyin", label: "抖音" }],
    },
  ],
  badge: "云目录",
  recentUsedAt: null,
  isRecent: false,
  runnerLabel: "本地即时执行",
  runnerTone: "emerald",
  runnerDescription: "客户端起步版可直接进入工作区执行。",
  actionLabel: "填写参数",
};

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

function renderDialog(
  props: Partial<React.ComponentProps<typeof ServiceSkillLaunchDialog>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof ServiceSkillLaunchDialog> = {
    skill: MOCK_SKILL,
    open: true,
    onOpenChange: vi.fn(),
    onLaunch: vi.fn(),
  };

  act(() => {
    root.render(<ServiceSkillLaunchDialog {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    props: {
      ...defaultProps,
      ...props,
    },
  };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setFormValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(
    new Event(
      element instanceof HTMLSelectElement ? "change" : "input",
      { bubbles: true },
    ),
  );
}

describe("ServiceSkillLaunchDialog", () => {
  it("应在必填参数补齐后允许进入工作区并透传槽位值", async () => {
    const onLaunch = vi.fn();

    renderDialog({
      onLaunch,
    });

    await flushEffects();

    const referenceInput = document.body.querySelector(
      '[data-testid="service-skill-slot-reference_video"]',
    ) as HTMLInputElement | null;
    const launchButton = document.body.querySelector(
      '[data-testid="service-skill-launch"]',
    ) as HTMLButtonElement | null;

    expect(referenceInput).toBeTruthy();
    expect(launchButton).toBeTruthy();
    expect(launchButton?.disabled).toBe(true);

    act(() => {
      if (referenceInput) {
        setFormValue(referenceInput, "https://example.com/video");
      }
    });

    await flushEffects();

    const enabledLaunchButton = document.body.querySelector(
      '[data-testid="service-skill-launch"]',
    ) as HTMLButtonElement | null;

    expect(enabledLaunchButton?.disabled).toBe(false);

    act(() => {
      enabledLaunchButton?.click();
    });

    expect(onLaunch).toHaveBeenCalledWith(MOCK_SKILL, {
      reference_video: "https://example.com/video",
      platform: "douyin",
    });
  });

  it("定时服务型技能应提供创建自动化任务入口", async () => {
    const onCreateAutomation = vi.fn();

    renderDialog({
      skill: {
        ...MOCK_SKILL,
        runnerType: "scheduled",
        defaultExecutorBinding: "automation_job",
        title: "每日趋势摘要",
      },
      onCreateAutomation,
    });

    await flushEffects();

    const referenceInput = document.body.querySelector(
      '[data-testid="service-skill-slot-reference_video"]',
    ) as HTMLInputElement | null;
    const createAutomationButton = document.body.querySelector(
      '[data-testid="service-skill-create-automation"]',
    ) as HTMLButtonElement | null;
    const enterWorkspaceButton = document.body.querySelector(
      '[data-testid="service-skill-enter-workspace"]',
    ) as HTMLButtonElement | null;

    expect(createAutomationButton).toBeTruthy();
    expect(enterWorkspaceButton).toBeTruthy();

    act(() => {
      if (referenceInput) {
        setFormValue(referenceInput, "https://example.com/video");
      }
    });

    await flushEffects();

    act(() => {
      createAutomationButton?.click();
    });

    expect(onCreateAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerType: "scheduled",
      }),
      {
        reference_video: "https://example.com/video",
        platform: "douyin",
      },
    );
  });
});
