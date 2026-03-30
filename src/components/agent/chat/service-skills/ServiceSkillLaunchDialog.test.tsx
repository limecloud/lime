import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSkillLaunchDialog } from "./ServiceSkillLaunchDialog";
import type { ServiceSkillHomeItem } from "./types";

const mockSiteGetAdapterLaunchReadiness = vi.fn();

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="service-skill-dialog">{children}</div> : null,
  DialogContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="service-skill-dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
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
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/lib/webview-api", () => ({
  siteGetAdapterLaunchReadiness: (...args: unknown[]) =>
    mockSiteGetAdapterLaunchReadiness(...args),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const MOCK_SKILL: ServiceSkillHomeItem = {
  id: "short-video-script-replication",
  skillType: "service",
  title: "复制短视频脚本",
  summary: "围绕参考视频的结构和节奏，输出一版可继续加工的脚本。",
  category: "视频创作",
  outputHint: "脚本大纲 + 镜头节奏",
  usageGuidelines: ["适合先锁定结构和节奏，再继续补镜头和口播细节。"],
  setupRequirements: [
    "需要已选择可用模型。",
    "建议在视频项目内启动，方便脚本直接回到当前工作区。",
  ],
  triggerHints: ["已经有参考视频，希望快速得到一版同结构脚本时使用。"],
  examples: ["参考这个视频结构，帮我先写一版节奏接近的脚本。"],
  outputDestination:
    "结果会写回当前工作区中的脚本草稿，方便继续补镜头与口播。",
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
  runnerDescription: "会直接在当前工作区生成首版结果，方便继续补充与改写。",
  actionLabel: "填写参数",
  automationStatus: null,
};

const METADATA_ONLY_SKILL: ServiceSkillHomeItem = {
  ...MOCK_SKILL,
  id: "metadata-only-site-skill",
  skillType: undefined,
  outputDestination: undefined,
  siteCapabilityBinding: undefined,
  skillBundle: {
    name: "metadata-only-site-skill",
    description: "只通过标准摘要回退展示技能类型与结果去向。",
    metadata: {
      Lime_skill_type: "site",
      Lime_output_destination: "结果会回流到当前工作区顶部结果区，便于继续整理。",
    },
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      deprecatedFields: [],
    },
  },
};

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockSiteGetAdapterLaunchReadiness.mockResolvedValue({
    status: "ready",
    adapter: "github/search",
    domain: "github.com",
    profile_key: "attached-github",
    target_id: "tab-github",
    message: "已检测到 github.com 的真实浏览器页面，Claw 可以直接复用当前会话执行。",
  });
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
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

describe("ServiceSkillLaunchDialog", () => {
  it("应展示技能标准信息区块", async () => {
    renderDialog();

    await flushEffects();

    expect(document.body.textContent).toContain("业务技能");
    expect(document.body.textContent).toContain("执行方式");
    expect(document.body.textContent).toContain("依赖条件");
    expect(document.body.textContent).toContain("结果去向");
    expect(document.body.textContent).toContain(
      "结果会写回当前工作区中的脚本草稿，方便继续补镜头与口播。",
    );
    expect(document.body.textContent).toContain(
      "适合先锁定结构和节奏，再继续补镜头和口播细节。",
    );
    expect(document.body.textContent).toContain(
      "参考这个视频结构，帮我先写一版节奏接近的脚本。",
    );
  });

  it("小屏幕下应为弹窗内容提供高度上限和内部滚动", async () => {
    renderDialog();

    await flushEffects();

    const dialogContent = document.body.querySelector(
      '[data-testid="service-skill-dialog-content"]',
    ) as HTMLDivElement | null;

    expect(dialogContent?.className).toContain("max-h-[calc(100vh-32px)]");
    expect(dialogContent?.className).toContain("overflow-y-auto");
    expect(dialogContent?.className).toContain("overscroll-contain");
  });

  it("缺少平铺字段时应从 skillBundle metadata 回退展示类型与结果去向", async () => {
    renderDialog({
      skill: METADATA_ONLY_SKILL,
    });

    await flushEffects();

    expect(document.body.textContent).toContain("站点技能");
    expect(document.body.textContent).toContain(
      "结果会回流到当前工作区顶部结果区，便于继续整理。",
    );
  });

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

  it("站点型服务技能应展示 Claw 主执行与浏览器工作台次级动作", async () => {
    const onOpenBrowserRuntime = vi.fn();
    renderDialog({
      skill: {
        ...MOCK_SKILL,
        id: "github-repo-radar",
        skillType: "site",
        title: "GitHub 仓库线索检索",
        defaultExecutorBinding: "browser_assist",
        summary:
          "复用你当前浏览器里的 GitHub 登录态，直接检索主题仓库并沉淀成结构化线索。",
        runnerLabel: "站点登录态采集",
        runnerDescription:
          "会复用当前浏览器里的真实登录态执行站点任务，并优先把结果沉淀到当前工作区。",
        actionLabel: "开始执行",
        setupRequirements: [
          "需要浏览器里已有 GitHub 登录态。",
          "建议在目标项目内启动，方便结果优先写回当前内容。",
        ],
        usageGuidelines: [
          "适合先做一轮主题检索，再回到工作区筛选值得继续跟进的仓库。",
        ],
        triggerHints: ["需要围绕某个技术主题快速找 GitHub 仓库线索时使用。"],
        examples: ["帮我查一批和 MCP browser automation 相关的 GitHub 仓库。"],
        outputDestination:
          "采集结果会优先写回当前内容；如果当前内容不可用，再沉淀为项目资源。",
        siteCapabilityBinding: {
          adapterName: "github/search",
          autoRun: true,
          saveMode: "current_content",
          slotArgMap: {
            reference_video: "query",
          },
        },
      },
      onOpenBrowserRuntime,
    });

    await flushEffects();

    expect(document.body.textContent).toContain("站点技能");
    expect(document.body.textContent).toContain("站点登录态采集");
    expect(document.body.textContent).toContain(
      "需要浏览器里已有 GitHub 登录态。",
    );
    expect(document.body.textContent).toContain(
      "采集结果会优先写回当前内容；如果当前内容不可用，再沉淀为项目资源。",
    );
    expect(document.body.textContent).toContain(
      "帮我查一批和 MCP browser automation 相关的 GitHub 仓库。",
    );
    expect(document.body.textContent).toContain("Claw 直跑检测");
    expect(document.body.textContent).toContain("可直接执行");
    const launchButton = document.body.querySelector(
      '[data-testid="service-skill-launch"]',
    ) as HTMLButtonElement | null;
    const browserRuntimeButton = document.body.querySelector(
      '[data-testid="service-skill-open-browser-runtime"]',
    ) as HTMLButtonElement | null;
    expect(launchButton?.textContent).toBe("在 Claw 中执行");
    expect(browserRuntimeButton?.textContent).toBe("去浏览器工作台");

    const referenceInput = document.body.querySelector(
      '[data-testid="service-skill-slot-reference_video"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (referenceInput) {
        setFormValue(referenceInput, "browser assist mcp");
      }
    });

    await flushEffects();

    expect(document.body.textContent).toContain(
      "你帮我在 GitHub 找一下和“browser assist mcp”相关的项目。",
    );

    act(() => {
      browserRuntimeButton?.click();
    });

    expect(onOpenBrowserRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "github-repo-radar",
      }),
      {
        reference_video: "browser assist mcp",
        platform: "douyin",
      },
    );
  });

  it("站点技能缺少附着会话时应阻断 Claw 主按钮，并提示先准备浏览器", async () => {
    mockSiteGetAdapterLaunchReadiness.mockResolvedValueOnce({
      status: "requires_browser_runtime",
      adapter: "github/search",
      domain: "github.com",
      message:
        "当前没有检测到已附着到真实浏览器的 github.com 页面，请先去浏览器工作台连接浏览器并打开目标页面。",
      report_hint:
        "Claw 不会在后台偷偷启动浏览器；请先进入浏览器工作台连接真实浏览器并打开目标站点页面，再返回 Claw 重试。",
    });

    renderDialog({
      skill: {
        ...MOCK_SKILL,
        id: "github-repo-radar",
        skillType: "site",
        defaultExecutorBinding: "browser_assist",
        siteCapabilityBinding: {
          adapterName: "github/search",
          autoRun: true,
          saveMode: "current_content",
          slotArgMap: {
            reference_video: "query",
          },
        },
      },
    });

    await flushEffects();

    const referenceInput = document.body.querySelector(
      '[data-testid="service-skill-slot-reference_video"]',
    ) as HTMLInputElement | null;
    const launchButton = document.body.querySelector(
      '[data-testid="service-skill-launch"]',
    ) as HTMLButtonElement | null;

    act(() => {
      if (referenceInput) {
        setFormValue(referenceInput, "browser assist mcp");
      }
    });

    await flushEffects();

    expect(document.body.textContent).toContain("需要先准备浏览器");
    expect(document.body.textContent).toContain("Claw 不会在后台偷偷启动浏览器");
    expect(document.body.textContent).toContain("请先进入浏览器工作台连接真实浏览器并打开目标站点页面");
    expect(launchButton?.disabled).toBe(true);
    expect(launchButton?.textContent).toBe("先准备浏览器再执行");
  });

  it("云端托管技能应显示云端运行文案且不暴露本地自动化入口", async () => {
    const onLaunch = vi.fn();
    const onCreateAutomation = vi.fn();

    renderDialog({
      skill: {
        ...MOCK_SKILL,
        id: "cloud-video-dubbing",
        title: "云端视频配音",
        executionLocation: "cloud_required",
        defaultExecutorBinding: "cloud_scene",
        runnerLabel: "云端托管执行",
        runnerTone: "slate",
        runnerDescription: "会提交到 OEM 云端执行，完成后再把结果回流到当前工作区。",
        actionLabel: "提交云端",
        outputDestination: "运行结果会在云端完成后回流到当前工作区。",
      },
      onLaunch,
      onCreateAutomation,
    });

    await flushEffects();

    expect(document.body.textContent).toContain("提交云端运行");
    expect(document.body.textContent).toContain(
      "运行结果会在云端完成后回流到当前工作区。",
    );
    expect(
      document.body.querySelector(
        '[data-testid="service-skill-enter-workspace"]',
      ),
    ).toBeNull();
    expect(
      document.body.querySelector(
        '[data-testid="service-skill-create-automation"]',
      ),
    ).toBeNull();

    const referenceInput = document.body.querySelector(
      '[data-testid="service-skill-slot-reference_video"]',
    ) as HTMLInputElement | null;
    const launchButton = document.body.querySelector(
      '[data-testid="service-skill-launch"]',
    ) as HTMLButtonElement | null;

    act(() => {
      if (referenceInput) {
        setFormValue(referenceInput, "https://example.com/cloud-video");
      }
    });

    await flushEffects();

    act(() => {
      launchButton?.click();
    });

    expect(onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cloud-video-dubbing",
        executionLocation: "cloud_required",
      }),
      {
        reference_video: "https://example.com/cloud-video",
        platform: "douyin",
      },
    );
    expect(onCreateAutomation).not.toHaveBeenCalled();
  });
});
