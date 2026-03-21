import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import { composeEntryPrompt } from "../utils/entryPromptComposer";

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(async () => ({})),
}));

const mockCharacterMention =
  vi.fn<
    (props: {
      characters?: Character[];
      skills?: Skill[];
      onSelectSkill?: (skill: Skill) => void;
      value: string;
      onChange: (value: string) => void;
    }) => React.ReactNode
  >();

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="chat-model-selector" />,
}));

vi.mock("../utils/entryPromptComposer", () => ({
  composeEntryPrompt: vi.fn(() => ""),
  createDefaultEntrySlotValues: vi.fn(() => ({})),
  formatEntryTaskPreview: vi.fn(() => ""),
  getEntryTaskTemplate: vi.fn(() => ({
    slots: [],
    description: "",
    label: "",
  })),
  SOCIAL_MEDIA_ENTRY_TASKS: [],
  validateEntryTaskSlots: vi.fn(() => ({ valid: true, missing: [] })),
}));

vi.mock("../utils/contextualRecommendations", () => ({
  buildRecommendationPrompt: vi.fn((fullPrompt: string) => fullPrompt),
  getContextualRecommendations: vi.fn(() => []),
}));

vi.mock("./Inputbar/components/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
    onSelectSkill?: (skill: Skill) => void;
    value: string;
    onChange: (value: string) => void;
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("./Inputbar/components/SkillSelector", () => ({
  SkillSelector: () => <div data-testid="skill-selector-stub" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetConfig.mockImplementation(async () => ({}));
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderEmptyState(
  props?: Partial<React.ComponentProps<typeof EmptyState>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof EmptyState> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "gpt-4.1",
    setModel: vi.fn(),
  };

  act(() => {
    root.render(<EmptyState {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("EmptyState", () => {
  it("应挂载 CharacterMention，并透传角色与技能", async () => {
    const characters: Character[] = [
      {
        id: "char-1",
        project_id: "project-1",
        name: "角色A",
        aliases: [],
        relationships: [],
        is_main: true,
        order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    const skills: Skill[] = [
      {
        key: "skill-1",
        name: "技能A",
        description: "desc",
        directory: "skill-a",
        installed: true,
        sourceKind: "builtin",
      },
    ];
    const setInput = vi.fn<(value: string) => void>();

    const container = renderEmptyState({
      input: "@",
      setInput,
      characters,
      skills,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const mention = container.querySelector(
      '[data-testid="character-mention-stub"]',
    );
    expect(mention).toBeTruthy();
    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(latestCall.characters).toEqual(characters);
    expect(latestCall.skills).toEqual(skills);

    act(() => {
      latestCall.onChange("@技能A");
    });
    expect(setInput).toHaveBeenCalledWith("@技能A");
  });

  it("选择技能后发送应自动附加 skill 前缀，且发送后清除激活技能", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const skill: Skill = {
      key: "canvas-design",
      name: "canvas-design",
      description: "desc",
      directory: "canvas-design",
      installed: true,
      sourceKind: "builtin",
    };

    const container = renderEmptyState({
      input: "帮我设计封面",
      onSend,
      skills: [skill],
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(typeof latestCall.onSelectSkill).toBe("function");

    act(() => {
      latestCall.onSelectSkill?.(skill);
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始生成"),
    );
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith(
      "/canvas-design 帮我设计封面",
      "react",
      undefined,
    );

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("帮我设计封面", "react", undefined);
  });

  it("点击地球按钮应切换联网搜索开关", async () => {
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      webSearchEnabled: false,
      onWebSearchEnabledChange,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const globeToggle = container.querySelector(
      'button[title="开启联网搜索"]',
    ) as HTMLButtonElement | null;
    expect(globeToggle).toBeTruthy();

    act(() => {
      globeToggle?.click();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
  });

  it("社媒主题发送时应默认走 social_post_with_cover skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇新品社媒文案");

    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始生成"),
    );
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/social_post_with_cover 请输出一篇新品社媒文案",
      "react",
      undefined,
    );
  });

  it("即使存在历史配置字段，社媒主题仍应自动注入默认 skill", async () => {
    mockGetConfig.mockImplementation(async () => ({
      chat_appearance: {},
    }));
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇用户访谈纪要");

    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始生成"),
    );
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/social_post_with_cover 请输出一篇用户访谈纪要",
      "react",
      undefined,
    );
  });

  it("社媒主题手动选择 skill 时应优先使用手动 skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇品牌故事");
    const skill: Skill = {
      key: "custom-social-skill",
      name: "custom-social-skill",
      description: "desc",
      directory: "custom-social-skill",
      installed: true,
      sourceKind: "builtin",
    };

    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
      skills: [skill],
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    act(() => {
      latestCall.onSelectSkill?.(skill);
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始生成"),
    );
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/custom-social-skill 请输出一篇品牌故事",
      "react",
      undefined,
    );
  });

  it("通用主题工具栏应包含附件、思考、后台任务与多代理开关", async () => {
    const onThinkingEnabledChange = vi.fn<(enabled: boolean) => void>();
    const onTaskEnabledChange = vi.fn<(enabled: boolean) => void>();
    const onSubagentEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      thinkingEnabled: false,
      onThinkingEnabledChange,
      taskEnabled: false,
      onTaskEnabledChange,
      subagentEnabled: false,
      onSubagentEnabledChange,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const attachButton = container.querySelector(
      'button[title="上传文件"]',
    ) as HTMLButtonElement | null;
    expect(attachButton).toBeTruthy();

    const thinkingButton = container.querySelector(
      'button[title="开启深度思考"]',
    ) as HTMLButtonElement | null;
    expect(thinkingButton).toBeTruthy();
    const taskButton = container.querySelector(
      'button[title="开启后台任务偏好"]',
    ) as HTMLButtonElement | null;
    expect(taskButton).toBeTruthy();
    const subagentButton = container.querySelector(
      'button[title="开启多代理偏好"]',
    ) as HTMLButtonElement | null;
    expect(subagentButton).toBeTruthy();

    act(() => {
      thinkingButton?.click();
    });
    act(() => {
      taskButton?.click();
    });
    act(() => {
      subagentButton?.click();
    });

    expect(onThinkingEnabledChange).toHaveBeenCalledWith(true);
    expect(onTaskEnabledChange).toHaveBeenCalledWith(true);
    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("通用主题应提供浏览器协助入口并触发启动回调", async () => {
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打开浏览器协助"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
  });

  it("应允许外部覆盖 supportingSlot", async () => {
    const container = renderEmptyState({
      supportingSlotOverride: (
        <div data-testid="custom-supporting-slot">自定义入口层</div>
      ),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="custom-supporting-slot"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("自定义入口层");
  });
});
