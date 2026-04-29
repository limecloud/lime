import React, { useRef, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterMention } from "./CharacterMention";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { UnifiedMemory } from "@/lib/api/unifiedMemory";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  saveSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import { filterMentionableServiceSkills } from "@/components/agent/chat/service-skills/entryAdapter";
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
} from "@/components/agent/chat/service-skills/types";
import { recordServiceSkillUsage } from "@/components/agent/chat/service-skills/storage";
import type { InputCapabilitySelection } from "./inputCapabilitySelection";
import { recordMentionEntryUsage } from "./mentionEntryUsage";
import { recordSlashEntryUsage } from "./slashEntryUsage";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  recordCuratedTaskTemplateUsage,
} from "../utils/curatedTaskTemplates";
import type { CuratedTaskReferenceEntry } from "../utils/curatedTaskReferenceSelection";
import {
  recordCuratedTaskRecommendationSignalFromMemory,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "../utils/curatedTaskRecommendationSignals";

const mockListServiceSkills = vi.hoisted(() => vi.fn());
const mockListUnifiedMemories = vi.hoisted(() =>
  vi.fn<() => Promise<UnifiedMemory[]>>(async () => []),
);

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api/serviceSkills", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/serviceSkills")>();

  return {
    ...actual,
    listServiceSkills: () => mockListServiceSkills(),
  };
});

vi.mock("@/lib/api/unifiedMemory", () => ({
  listUnifiedMemories: mockListUnifiedMemories,
}));

vi.mock("@/components/ui/popover", () => {
  const Popover = ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="mention-popover">{children}</div> : null);

  const PopoverTrigger = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );

  const PopoverContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
      side?: string;
      align?: string;
      avoidCollisions?: boolean;
      sideOffset?: number;
      onOpenAutoFocus?: (event: Event) => void;
    }
  >(
    (
      {
        children,
        className,
        style,
        side,
        align,
        avoidCollisions,
        sideOffset: _sideOffset,
        onOpenAutoFocus: _onOpenAutoFocus,
        ...props
      },
      ref,
    ) => (
      <div
        ref={ref}
        className={className}
        style={style}
        data-side={side}
        data-align={align}
        data-avoid-collisions={String(avoidCollisions)}
        {...props}
      >
        {children}
      </div>
    ),
  );

  return { Popover, PopoverTrigger, PopoverContent };
});

vi.mock("@/components/ui/command", () => {
  const Command = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
  >(({ children, ...props }, ref) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ));

  const CommandInput = ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      data-testid="mention-command-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  );

  const CommandList = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  const CommandGroup = ({
    heading,
    children,
  }: {
    heading?: string;
    children: React.ReactNode;
  }) => (
    <section>
      {heading && <div>{heading}</div>}
      {children}
    </section>
  );

  const CommandItem = ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  );

  const CommandEmpty = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Command,
    CommandInput,
    CommandList,
    CommandGroup,
    CommandItem,
    CommandEmpty,
  };
});

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
    ...rest
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
    className,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
    className?: string;
  }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  clearSkillCatalogCache();
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
  window.localStorage.clear();
  clearSkillCatalogCache();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockListServiceSkills.mockResolvedValue([]);
  mockListUnifiedMemories.mockResolvedValue([]);
});

interface HarnessProps {
  characters?: Character[];
  skills?: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  serviceSkillGroups?: ServiceSkillGroup[];
  syncValue?: boolean;
  onNavigateToSettings?: () => void;
  onChangeSpy?: (value: string) => void;
  onSelectInputCapability?: (
    capability: InputCapabilitySelection,
    options?: { replayText?: string },
  ) => void;
  projectId?: string | null;
  sessionId?: string | null;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
  inputCompletionEnabled?: boolean;
}

const Harness: React.FC<HarnessProps> = ({
  characters = [],
  skills = [],
  serviceSkills = [],
  serviceSkillGroups = [],
  syncValue = true,
  onNavigateToSettings,
  onChangeSpy,
  onSelectInputCapability,
  projectId = null,
  sessionId = null,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
  inputCompletionEnabled = true,
}) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <textarea
        ref={inputRef}
        data-testid="mention-input"
        defaultValue=""
        onChange={(event) => {
          if (syncValue) {
            setValue(event.target.value);
          }
        }}
      />
      <CharacterMention
        characters={characters}
        skills={skills}
        serviceSkills={serviceSkills}
        serviceSkillGroups={serviceSkillGroups}
        inputRef={inputRef}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          if (syncValue) {
            setValue(next);
          }
        }}
        onSelectInputCapability={onSelectInputCapability}
        projectId={projectId}
        sessionId={sessionId}
        defaultCuratedTaskReferenceMemoryIds={
          defaultCuratedTaskReferenceMemoryIds
        }
        defaultCuratedTaskReferenceEntries={defaultCuratedTaskReferenceEntries}
        onNavigateToSettings={onNavigateToSettings}
        inputCompletionEnabled={inputCompletionEnabled}
      />
    </div>
  );
};

function renderHarness(props: HarnessProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Harness {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector(
    '[data-testid="mention-input"]',
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    throw new Error("未找到输入框");
  }
  return textarea;
}

function typeAt(textarea: HTMLTextAreaElement) {
  act(() => {
    textarea.focus();
    textarea.value = "@";
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typeMention(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    textarea.focus();
    textarea.value = value;
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typeSlash(textarea: HTMLTextAreaElement, value = "/") {
  act(() => {
    textarea.focus();
    textarea.value = value;
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeAtAndWait(textarea: HTMLTextAreaElement) {
  await act(async () => {
    await import("./CharacterMentionPanel");
  });

  typeAt(textarea);
  await act(async () => {
    await Promise.resolve();
  });
}

async function typeMentionAndWait(
  textarea: HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    await import("./CharacterMentionPanel");
  });

  typeMention(textarea, value);
  await act(async () => {
    await Promise.resolve();
  });
}

async function typeSlashAndWait(textarea: HTMLTextAreaElement, value = "/") {
  await act(async () => {
    await import("./CharacterMentionPanel");
  });

  typeSlash(textarea, value);
  await act(async () => {
    await Promise.resolve();
  });
}

function updateFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  expect(element).toBeTruthy();
  if (!element) {
    return;
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findLauncherConfirmButton() {
  return (
    (document.body.querySelector(
      '[data-testid="curated-task-launcher-confirm"]',
    ) as HTMLButtonElement | null) ??
    (Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("开始生成"),
    ) as HTMLButtonElement | undefined)
  );
}

function createSkill(
  name: string,
  key: string,
  installed: boolean,
  overrides: Partial<Skill> = {},
): Skill {
  return {
    key,
    name,
    description: "测试技能",
    directory: `${key}-dir`,
    installed,
    sourceKind: "builtin",
    ...overrides,
  };
}

function createCharacter(name: string): Character {
  const now = new Date().toISOString();
  return {
    id: "char-1",
    project_id: "project-1",
    name,
    aliases: [],
    description: "测试角色",
    personality: undefined,
    background: undefined,
    appearance: undefined,
    relationships: [],
    avatar_url: undefined,
    is_main: true,
    order: 0,
    extra: undefined,
    created_at: now,
    updated_at: now,
  };
}

function createServiceSkill(
  overrides: Partial<ServiceSkillHomeItem> = {},
): ServiceSkillHomeItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "围绕指定平台与关键词输出趋势摘要。",
    entryHint: "把平台和关键词给我，我先整理一份趋势报告。",
    aliases: ["趋势报告", "热点摘要"],
    category: "内容运营",
    outputHint: "趋势摘要 + 调度建议",
    source: "cloud_catalog",
    runnerType: "scheduled",
    defaultExecutorBinding: "automation_job",
    executionLocation: "client_default",
    slotSchema: [],
    surfaceScopes: ["home", "mention", "workspace"],
    promptTemplateKey: "trend_briefing",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "本地计划任务",
    runnerTone: "sky",
    runnerDescription: "当前先进入工作区生成首版任务方案，后续再接本地自动化。",
    actionLabel: "先做方案",
    automationStatus: null,
    groupKey: "general",
    ...overrides,
  };
}

function createXArticleSceneServiceSkill(
  overrides: Partial<ServiceSkillHomeItem> = {},
): ServiceSkillHomeItem {
  return createServiceSkill({
    id: "x-article-export",
    skillKey: "x-article-export",
    title: "X 文章转存",
    summary: "复用 X 登录态把长文导出成 Markdown。",
    category: "站点采集",
    outputHint: "Markdown 正文 + 图片目录",
    source: "local_custom",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    slotSchema: [
      {
        key: "article_url",
        label: "X 文章链接",
        type: "url",
        required: true,
        placeholder: "https://x.com/<账号>/article/<文章ID>",
      },
    ],
    sceneBinding: {
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      title: "X文章转存",
      summary: "把 X 长文导出成 Markdown。",
      aliases: ["x文章转存", "x转存"],
    },
    siteCapabilityBinding: {
      adapterName: "x/article-export",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "project_resource",
      slotArgMap: {
        article_url: "url",
      },
    },
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    ...overrides,
  });
}

function buildCatalogWithSceneEntry(): SkillCatalog {
  const seeded = getSeededSkillCatalog();

  return {
    ...seeded,
    tenantId: "tenant-scene-demo",
    version: "tenant-scene-demo-2026-04-05",
    syncedAt: "2026-04-05T12:00:00.000Z",
    entries: [
      ...seeded.entries,
      {
        id: "scene:campaign-launch",
        kind: "scene",
        title: "新品发布场景",
        summary: "把链接解析、配图和封面串成一条产品链路。",
        sceneKey: "campaign-launch",
        commandPrefix: "/campaign-launch",
        aliases: ["launch", "campaign"],
        executionKind: "scene",
        renderContract: {
          resultKind: "tool_timeline",
          detailKind: "scene_detail",
          supportsStreaming: true,
          supportsTimeline: true,
        },
      },
    ],
  };
}

function buildCatalogWithXSceneEntry(): SkillCatalog {
  const seeded = getSeededSkillCatalog();

  return {
    ...seeded,
    tenantId: "tenant-x-scene-demo",
    version: "tenant-x-scene-demo-2026-04-07",
    syncedAt: "2026-04-07T12:00:00.000Z",
    entries: [
      ...seeded.entries.filter(
        (entry) =>
          entry.kind !== "scene" || entry.sceneKey !== "x-article-export",
      ),
      {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        aliases: ["x文章转存", "x转存"],
        linkedSkillId: "x-article-export",
        executionKind: "site_adapter",
      },
    ],
  };
}

describe("CharacterMention", () => {
  it("输入 @ 当次应弹出提及面板（不依赖受控 value 同步）", async () => {
    const container = renderHarness({
      characters: [createCharacter("测试角色")],
      syncValue: false,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("测试角色");
  });

  it("关闭输入自动补全后不应再弹出现有提及面板", async () => {
    const container = renderHarness({
      characters: [createCharacter("测试角色")],
      inputCompletionEnabled: false,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(
      document.body.querySelector('[data-testid="mention-popover-content"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("测试角色");
  });

  it("无角色和技能时仍应显示内建图片命令", async () => {
    const container = renderHarness({
      characters: [],
      skills: [],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("统一调用注册表");
    expect(document.body.textContent).toContain("先调命令，再补做法");
    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("搜索 / 读取");
    expect(document.body.textContent).toContain("浏览器 / 编排");
    expect(document.body.textContent).toContain("@配图");
    expect(document.body.textContent).toContain("@封面");
    expect(document.body.textContent).toContain("@海报");
    expect(document.body.textContent).toContain("@修图");
    expect(document.body.textContent).toContain("@重绘");
    expect(document.body.textContent).toContain("@视频");
    expect(document.body.textContent).toContain("@配音");
    expect(document.body.textContent).toContain("@播报");
    expect(document.body.textContent).toContain("@素材");
    expect(document.body.textContent).toContain("@研报");
    expect(document.body.textContent).toContain("@竞品");
    expect(document.body.textContent).toContain("@读PDF");
    expect(document.body.textContent).toContain("@转写");
    expect(document.body.textContent).toContain("@链接解析");
    expect(document.body.textContent).toContain("@浏览器");
  });

  it("提供 onSelectInputCapability 时，选择配图命令应走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@配图"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "builtin_command",
        command: expect.objectContaining({
          key: "image_generate",
          commandPrefix: "@配图",
        }),
      }),
      undefined,
    );
    expect(onChangeSpy).toHaveBeenLastCalledWith("");
  });

  it("服务技能应出现在 @ 面板里", async () => {
    const container = renderHarness({
      serviceSkills: [
        createServiceSkill(),
        createServiceSkill({
          id: "github-repo-radar",
          title: "GitHub 仓库雷达",
          summary: "围绕仓库与 Issue 快速扫描线索。",
          entryHint: "补一个关键词，我先帮你扫 GitHub 仓库与讨论。",
          aliases: ["仓库雷达", "GitHub 搜索"],
          category: "GitHub",
          runnerType: "instant",
          defaultExecutorBinding: "browser_assist",
          slotSchema: [
            {
              key: "repository_query",
              label: "仓库关键词",
              type: "text",
              required: true,
              placeholder: "例如 AI Agent",
            },
          ],
          runnerLabel: "浏览器协助",
          runnerTone: "sky",
          runnerDescription: "进入真实浏览器执行只读采集。",
          actionLabel: "对话内补参",
          groupKey: "github",
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("场景做法");
    expect(document.body.textContent).toContain("每日趋势摘要");
    expect(document.body.textContent).toContain("GitHub 仓库雷达");
    expect(document.body.textContent).toContain("需要：当前无必填信息");
    expect(document.body.textContent).toContain("交付：趋势摘要 + 调度建议");
    expect(document.body.textContent).toContain("需要：仓库关键词");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("搜索 / 读取")).toBeLessThan(
      bodyText.indexOf("场景做法"),
    );
  });

  it("最近使用的服务技能应优先显示在独立分组，且不在技能组里重复", async () => {
    act(() => {
      recordServiceSkillUsage({
        skillId: "recent-trend-briefing",
        runnerType: "scheduled",
        slotValues: {
          platform_focus: "X + TikTok",
          keyword_focus: "AI 内容创作",
        },
      });
    });
    const recentSkill = createServiceSkill({
      id: "recent-trend-briefing",
      title: "最近趋势摘要",
      slotSchema: [
        {
          key: "platform_focus",
          label: "关注平台",
          type: "text",
          required: true,
          placeholder: "例如 X + TikTok",
        },
        {
          key: "keyword_focus",
          label: "关键词",
          type: "text",
          required: true,
          placeholder: "例如 AI 内容创作",
        },
      ],
      recentUsedAt: 1_712_345_678_000,
      isRecent: true,
    });
    const regularSkill = createServiceSkill({
      id: "regular-trend-briefing",
      title: "常规趋势摘要",
    });
    const container = renderHarness({
      serviceSkills: [recentSkill, regularSkill],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("最近调用");
    expect(document.body.textContent).toContain("场景做法");
    expect(document.body.textContent).toContain(
      "上次填写：关注平台=X + TikTok；关键词=AI 内容创作",
    );

    const recentButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("最近趋势摘要"));
    expect(recentButtons).toHaveLength(1);

    const regularButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("常规趋势摘要"));
    expect(regularButtons).toHaveLength(1);
  });

  it("@ 空查询时应优先显示最近调用的内建命令，且不在内建命令分组重复", async () => {
    act(() => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_900,
      });
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("最近调用");

    const recentCommandButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("@搜索"));
    expect(recentCommandButtons).toHaveLength(1);
  });

  it("@ 面板打开后新增内建命令 recent usage 时，应即时刷新最近调用分组", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).not.toContain("最近调用");

    await act(async () => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_901,
        replayText: "关键词:AI Agent 融资 站点:36Kr",
      });
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("最近调用");
    expect(document.body.textContent).toContain("@搜索");
    expect(document.body.textContent).toContain(
      "上次输入：关键词:AI Agent 融资",
    );
  });

  it("选择最近使用的 @命令时应回填上次成功草稿", async () => {
    const replayText = "关键词:AI Agent 融资 站点:36Kr";
    act(() => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_900,
        replayText,
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("上次输入：");
    expect(document.body.textContent).toContain("关键词:AI Agent 融资");

    const recentCommandButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@搜索"));
    expect(recentCommandButton).toBeTruthy();

    act(() => {
      recentCommandButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith(replayText);
    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "builtin_command",
        command: expect.objectContaining({
          key: "research",
        }),
      }),
      expect.objectContaining({
        replayText,
      }),
    );
  });

  it("普通 @命令搜索结果也应自动带入上次成功草稿", async () => {
    const replayText =
      "关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点";
    act(() => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_900,
        replayText,
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeMentionAndWait(textarea, "@搜");

    expect(document.body.textContent).toContain("上次输入：");
    expect(document.body.textContent).toContain(
      "关键词:AI Agent 融资 站点:36Kr 时间:近30天",
    );

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@搜索"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith(replayText);
    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "builtin_command",
        command: expect.objectContaining({
          key: "research",
          commandPrefix: "@搜索",
        }),
      }),
      expect.objectContaining({
        replayText,
      }),
    );
  });

  it("普通 @命令搜索结果在只有 slotValues 时也应自动反推参数骨架", async () => {
    const replayText =
      "关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点";
    act(() => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_900,
        slotValues: {
          query: "AI Agent 融资",
          site: "36Kr",
          time_range: "近30天",
          depth: "deep",
          focus: "融资额与产品发布",
          output_format: "要点",
        },
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeMentionAndWait(textarea, "@搜");

    expect(document.body.textContent).toContain("上次输入：");
    expect(document.body.textContent).toContain(
      "关键词:AI Agent 融资 站点:36Kr 时间:近30天",
    );

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@搜索"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith(replayText);
    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "builtin_command",
        command: expect.objectContaining({
          key: "research",
          commandPrefix: "@搜索",
        }),
      }),
      expect.objectContaining({
        replayText,
      }),
    );
  });

  it("@ 搜索时不应显示最近调用，而应回到普通命令结果", async () => {
    act(() => {
      recordMentionEntryUsage({
        kind: "builtin_command",
        entryId: "research",
        usedAt: 1_712_345_678_900,
      });
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@搜";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("最近调用");
    expect(document.body.textContent).toContain("搜索 / 读取");
    expect(document.body.textContent).toContain("@搜索");
  });

  it("@ 面板中的已安装技能应展示统一的轻量 skill 合同", async () => {
    const container = renderHarness({
      skills: [
        createSkill("写作助手", "skill-writer", true, {
          description: "本地补充技能",
          metadata: {
            lime_when_to_use: "当你需要复用本地写作方法时使用。",
            lime_argument_hint: "主题、受众与语气要求",
          },
        }),
        createSkill("脚本助手", "skill-script", true, {
          description: "另一条备用本地做法",
          metadata: {
            lime_when_to_use: "当你需要改写脚本结构时使用。",
            lime_argument_hint: "脚本目标与表达风格",
          },
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("我的方法");
    expect(document.body.textContent).toContain("写作助手");
    expect(document.body.textContent).toContain(
      "当你需要复用本地写作方法时使用。",
    );
    expect(document.body.textContent).toContain("需要：主题、受众与语气要求");
    expect(document.body.textContent).toContain("交付：带着该方法进入生成");
  });

  it("只有最近使用的服务技能时，不应同时出现空态文案", async () => {
    const container = renderHarness({
      serviceSkills: [
        createServiceSkill({
          id: "recent-trend-briefing",
          title: "最近趋势摘要",
          recentUsedAt: 1_712_345_678_000,
          isRecent: true,
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("最近调用");
    expect(document.body.textContent).toContain("最近趋势摘要");
    expect(document.body.textContent).not.toContain("暂无可用角色或技能");
  });

  it("输入 @ 查询服务技能时，应回到按技能组展示搜索结果", async () => {
    const container = renderHarness({
      serviceSkills: [
        createServiceSkill({
          id: "github-repo-radar",
          title: "GitHub 仓库雷达",
          aliases: ["仓库雷达", "GitHub 搜索"],
          groupKey: "github",
          recentUsedAt: 1_712_345_678_000,
          isRecent: true,
          runnerType: "instant",
          defaultExecutorBinding: "browser_assist",
          runnerLabel: "浏览器协助",
          runnerTone: "sky",
          runnerDescription: "进入真实浏览器执行只读采集。",
          actionLabel: "对话内补参",
        }),
      ],
    });
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@git";
      textarea.setSelectionRange(4, 4);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("最近调用");
    expect(document.body.textContent).not.toContain("场景做法");
    expect(document.body.textContent).toContain("GitHub");
    expect(document.body.textContent).toContain("GitHub 仓库雷达");
  });

  it("@ 面板技能组标题和排序应优先复用后端目录分组", async () => {
    const container = renderHarness({
      serviceSkills: [
        createServiceSkill({
          id: "creative-workbench-brief",
          title: "创作工作台摘要",
          aliases: ["创作摘要"],
          groupKey: "creative-workbench",
        }),
        createServiceSkill({
          id: "general-brief",
          title: "通用创作摘要",
          aliases: ["通用摘要"],
          groupKey: "general",
        }),
      ],
      serviceSkillGroups: [
        {
          key: "general",
          title: "通用技能",
          summary: "常规创作技能。",
          sort: 90,
          itemCount: 1,
        },
        {
          key: "creative-workbench",
          title: "创作中台",
          summary: "围绕创作链路的协作技能。",
          sort: 5,
          itemCount: 1,
        },
      ],
    });
    const textarea = getTextarea(container);

    await typeMentionAndWait(textarea, "@摘要");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("创作中台");
    expect(bodyText).toContain("通用技能");
    expect(bodyText).not.toContain("技能组 · creative-workbench");
    expect(bodyText.indexOf("创作中台")).toBeLessThan(
      bodyText.indexOf("通用技能"),
    );
  });

  it("输入 @网 时应展示新的内建网页命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@网";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("@网页");
  });

  it("输入 @P 时应展示新的内建 PPT 命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@P";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("@PPT");
  });

  it("输入 @表 时应展示新的内建表单命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@表";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("@表单");
  });

  it("输入 @代 时应展示新的内建代码命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@代";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("浏览器 / 编排");
    expect(document.body.textContent).toContain("@代码");
  });

  it("输入 @发 时应展示新的内建发布命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@发";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("预览 / 发布");
    expect(document.body.textContent).toContain("@发布");
  });

  it("输入 @配 时应同时展示配图与配音命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@配";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("媒体转换");
    expect(document.body.textContent).toContain("@配图");
    expect(document.body.textContent).toContain("@配音");
  });

  it("输入 @海 时应展示新的海报命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@海";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("生成 / 表达");
    expect(document.body.textContent).toContain("@海报");
  });

  it("输入 @渠 时应展示新的渠道预览命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@渠";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("预览 / 发布");
    expect(document.body.textContent).toContain("@渠道预览");
  });

  it("输入 @上 时应展示新的上传命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@上";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("预览 / 发布");
    expect(document.body.textContent).toContain("@上传");
  });

  it("输入 @合 时应展示新的发布合规命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@合";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("预览 / 发布");
    expect(document.body.textContent).toContain("@发布合规");
  });

  it("输入 @浏 时应展示新的内建浏览器命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@浏";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("浏览器 / 编排");
    expect(document.body.textContent).toContain("@浏览器");
  });

  it("输入 @竞 时应展示新的竞品命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@竞";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("搜索 / 读取");
    expect(document.body.textContent).toContain("@竞品");
  });

  it("输入 @抓 时应展示新的网页抓取命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@抓";
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("搜索 / 读取");
    expect(document.body.textContent).toContain("@抓取");
  });

  it("输入 @网页读 时应展示新的网页读取命令", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await act(async () => {
      await import("./CharacterMentionPanel");
    });

    act(() => {
      textarea.focus();
      textarea.value = "@网页读";
      textarea.setSelectionRange(4, 4);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("搜索 / 读取");
    expect(document.body.textContent).toContain("@网页读取");
  });

  it("服务技能过滤应支持命中别名", () => {
    const filtered = filterMentionableServiceSkills(
      [
        createServiceSkill(),
        createServiceSkill({
          id: "carousel-post-replication",
          title: "复制轮播帖",
          aliases: ["轮播帖", "小红书轮播"],
          runnerType: "instant",
          defaultExecutorBinding: "agent_turn",
          runnerLabel: "本地即时执行",
          runnerTone: "emerald",
          runnerDescription: "客户端起步版可直接进入工作区执行。",
          actionLabel: "对话内补参",
          promptTemplateKey: "replication",
        }),
      ],
      "轮播",
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("carousel-post-replication");
  });

  it("提供统一 capability 回调时，选择服务技能应走 current 主链", async () => {
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const onChangeSpy = vi.fn<(value: string) => void>();
    const serviceSkill = createServiceSkill();
    const container = renderHarness({
      serviceSkills: [serviceSkill],
      onSelectInputCapability,
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const serviceSkillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(serviceSkillButton).toBeTruthy();

    act(() => {
      serviceSkillButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("");
    expect(onSelectInputCapability).toHaveBeenCalledWith({
      kind: "service_skill",
      skill: serviceSkill,
    });
  });

  it("未提供统一 capability 回调时，选择已安装技能应回填到输入框", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const skillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("技能A"));
    expect(skillButton).toBeTruthy();

    act(() => {
      skillButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/skill-a ");
  });

  it("输入 / 时应优先显示先拿结果、已经沉淀的方法与工作台操作，而不是把全部命令摊平", async () => {
    const container = renderHarness({
      skills: [createSkill("本地做法A", "local-skill-a", true)],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("先拿结果");
    expect(document.body.textContent).toContain("工作台操作");
    expect(document.body.textContent).toContain("新建任务");
    expect(document.body.textContent).toContain("清空任务");
    expect(document.body.textContent).toContain("压缩上下文");
    expect(document.body.textContent).toContain(
      "整理当前任务时再用，不会替代上面的结果入口。",
    );
    expect(document.body.textContent).toContain("/compact");
    expect(document.body.textContent).not.toContain(
      "压缩当前会话上下文并写入摘要",
    );
    expect(document.body.textContent).toContain("已经沉淀的方法");
    expect(document.body.textContent).not.toContain("/review");
    expect(document.body.textContent).not.toContain("/help");
    expect(document.body.textContent).not.toContain("/quit");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("先拿结果")).toBeLessThan(
      bodyText.indexOf("已经沉淀的方法"),
    );
    expect(bodyText.indexOf("已经沉淀的方法")).toBeLessThan(
      bodyText.indexOf("工作台操作"),
    );
  });

  it("统一目录中的结果模板应出现在 slash 面板里", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    expect(document.body.textContent).toContain("结果模板");
    expect(document.body.textContent).toContain("新品发布场景");
    expect(document.body.textContent).not.toContain("/campaign-launch");
    expect(document.body.textContent).toContain(
      "把链接解析、配图和封面串成一条产品链路。",
    );
  });

  it("共享 curated task 结果模板也应出现在 slash 面板里，并通过 launcher 回填启动提示", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const container = renderHarness({
      onChangeSpy,
      syncValue: true,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/趋势");

    expect(document.body.textContent).toContain("结果模板");
    expect(document.body.textContent).toContain(
      "需要：主题或赛道、希望关注的平台/地域",
    );
    expect(document.body.textContent).toContain("交付：趋势摘要、3 个优先选题");
    expect(document.body.textContent).toContain(
      "去向：趋势摘要会先写回当前内容，方便继续展开选题和主稿。",
    );
    const templateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    expect(document.body.textContent).toContain(
      "开始这一步前，我先确认几件事。",
    );
    expect(onChangeSpy).not.toHaveBeenCalled();

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(onChangeSpy).toHaveBeenCalledWith(
      buildCuratedTaskLaunchPrompt({
        task: template!,
        inputValues: {
          theme_target: "AI 内容创作",
          platform_region: "X 与 TikTok 北美区",
        },
      }),
    );
  });

  it("slash 面板里的复盘结果模板应显影当前结果基线摘要", async () => {
    const container = renderHarness({
      defaultCuratedTaskReferenceEntries: [
        {
          id: "sceneapp:ai-weekly:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "已有一轮可继续放量的结果。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "增长"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "当前判断：适合继续放量 经营动作：保留品牌联名方向 更适合去向：内容主稿生成 / 渠道改写",
            },
          },
        },
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/复盘");

    expect(document.body.textContent).toContain("结果模板");
    expect(document.body.textContent).toContain("复盘这个账号/项目");
    expect(document.body.textContent).toContain("当前结果基线：AI 内容周报");
    expect(document.body.textContent).toContain("当前判断：适合继续放量");
    expect(document.body.textContent).toContain(
      "更适合去向：内容主稿生成 / 渠道改写",
    );
  });

  it("slash 面板里的下游结果模板也应继续显影 sceneapp 基线摘要", async () => {
    const container = renderHarness({
      defaultCuratedTaskReferenceEntries: [
        {
          id: "sceneapp:ai-weekly:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "已有一轮可继续放量的结果。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "增长"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "当前判断：适合继续放量 经营动作：保留品牌联名方向 更适合去向：内容主稿生成 / 渠道改写",
            },
          },
        },
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/趋势");

    expect(document.body.textContent).toContain("每日趋势摘要");
    expect(document.body.textContent).toContain("当前结果基线：AI 内容周报");
    expect(document.body.textContent).toContain("当前判断：适合继续放量");
    expect(document.body.textContent).toContain(
      "更适合去向：内容主稿生成 / 渠道改写",
    );
  });

  it("搜索命中的普通结果模板也应继续沿用最近一次启动参数", async () => {
    act(() => {
      recordCuratedTaskTemplateUsage({
        templateId: "daily-trend-briefing",
        launchInputValues: {
          theme_target: "AI 内容创作",
          platform_region: "X 与 TikTok 北美区",
        },
      });
    });

    const container = renderHarness({
      syncValue: true,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/趋势");

    const templateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(templateButton).toBeTruthy();

    await act(async () => {
      templateButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "已根据你上次启动 每日趋势摘要 时的参数自动预填，可继续修改后进入生成。",
    );

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    expect(themeInput?.value).toBe("AI 内容创作");
    expect(platformInput?.value).toBe("X 与 TikTok 北美区");
  });

  it("提供 onSelectInputCapability 时，slash 面板选择结果模板应在 launcher 确认后走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
      syncValue: true,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/趋势");

    const templateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(onSelectInputCapability).not.toHaveBeenCalled();

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    const prompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: {
        theme_target: "AI 内容创作",
        platform_region: "X 与 TikTok 北美区",
      },
    });

    expect(onChangeSpy).toHaveBeenCalledWith(prompt);
    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "curated_task",
        task: expect.objectContaining({
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          prompt,
        }),
      }),
      {
        replayText: prompt,
      },
    );
  });

  it("slash 面板启动结果模板时，应默认沿用当前带入的灵感引用", async () => {
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-1",
        session_id: "session-1",
        memory_type: "project",
        title: "品牌风格样本",
        category: "context",
        summary: "保留轻盈但专业的表达。",
        content: "保留轻盈但专业的表达。",
        tags: ["品牌", "语气"],
        metadata: {
          confidence: 0.9,
          importance: 7,
          access_count: 1,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
    ]);

    const container = renderHarness({
      defaultCuratedTaskReferenceMemoryIds: ["memory-1"],
      defaultCuratedTaskReferenceEntries: [
        {
          id: "memory-1",
          title: "品牌风格样本",
          summary: "保留轻盈但专业的表达。",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "语气"],
        },
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/趋势");

    const templateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "已选择 1 条参考对象，本轮会一起带入生成。",
    );
  });

  it("slash 面板的结果模板应复用保存到灵感库后的推荐信号排序", async () => {
    recordCuratedTaskRecommendationSignalFromMemory(
      {
        id: "memory-review-1",
        session_id: "session-review-1",
        memory_type: "project",
        title: "本周账号复盘线索",
        category: "experience",
        summary: "内容表现、增长拐点和掉量问题都在这里。",
        content: "内容表现、增长拐点和掉量问题都在这里。",
        tags: ["复盘", "增长", "账号"],
        metadata: {
          confidence: 0.96,
          importance: 8,
          access_count: 1,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
      {
        projectId: "project-review-1",
      },
    );

    const container = renderHarness({
      projectId: "project-review-1",
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("成果：本周账号复盘线索");

    const resultTemplateSection = Array.from(
      document.body.querySelectorAll("section"),
    ).find((section) => section.textContent?.includes("先拿结果"));
    expect(resultTemplateSection).toBeTruthy();

    const buttonTexts = Array.from(
      resultTemplateSection?.querySelectorAll("button") ?? [],
    ).map((button) => button.textContent ?? "");
    const reviewIndex = buttonTexts.findIndex((text) =>
      text.includes("复盘这个账号/项目"),
    );
    const trendIndex = buttonTexts.findIndex((text) =>
      text.includes("每日趋势摘要"),
    );

    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(trendIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeLessThan(trendIndex);
  });

  it("slash 面板的结果模板分组应显影最近判断横幅", async () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-needs-evidence",
        decision_status: "needs_more_evidence",
        decision_summary:
          "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-review-2",
        sceneTitle: "短视频编排",
      },
    );

    const container = renderHarness({
      projectId: "project-review-2",
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const banner = document.body.querySelector(
      '[data-testid="input-capability-section-banner-result-templates"]',
    );
    expect(banner?.textContent).toContain(
      "最近判断已更新：短视频编排 · 补证据",
    );
    expect(banner?.textContent).toContain("这轮结果还缺证据");
    expect(banner?.textContent).toContain("这轮判断更建议优先回到");
    expect(banner?.textContent).toContain("复盘这个账号/项目");
    expect(banner?.textContent).toContain("拆解一条爆款内容");
    expect(banner?.textContent).toContain(
      "更适合继续：复盘这个账号/项目 / 拆解一条爆款内容",
    );

    const bannerAction = document.body.querySelector(
      '[data-testid="input-capability-section-banner-action-result-templates"]',
    ) as HTMLButtonElement | null;
    expect(bannerAction?.textContent).toContain("继续去「复盘这个账号/项目」");

    await act(async () => {
      bannerAction?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "开始这一步前，我先确认几件事。",
    );
    expect(document.body.textContent).toContain("复盘这个账号/项目");
  });

  it("搜索未接入的 slash 命令时，应单独显示暂未接入分组", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/qui");

    expect(document.body.textContent).not.toContain("工作台操作");
    expect(document.body.textContent).toContain("暂未接入");
    expect(document.body.textContent).toContain("/quit");
  });

  it("slash 搜索提示类命令时，应按提示命令分组展开", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/rev");

    expect(document.body.textContent).toContain("提示命令");
    expect(document.body.textContent).toContain("/review");
    expect(document.body.textContent).not.toContain("状态 / 帮助");
  });

  it("slash 搜索状态类命令时，应按状态 / 帮助分组展开", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/help");

    expect(document.body.textContent).toContain("状态 / 帮助");
    expect(document.body.textContent).toContain("/help");
  });

  it("slash 空查询时应优先显示继续上次做法，且不在原分组重复", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
      recordSlashEntryUsage({
        kind: "command",
        entryId: "compact",
        usedAt: 1_712_345_678_900,
      });
      recordSlashEntryUsage({
        kind: "scene",
        entryId: "campaign-launch",
        usedAt: 1_712_345_678_800,
      });
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "skill-a",
        usedAt: 1_712_345_678_700,
      });
      recordCuratedTaskTemplateUsage("social-post-starter");
    });

    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("继续上次做法");
    expect(document.body.textContent).toContain("最近操作");
    expect(document.body.textContent).toContain("压缩上下文");
    expect(document.body.textContent).toContain(
      "最近用过的工作台动作；如果是继续产出，优先看上面的做法。",
    );

    const compactButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("/compact"));
    expect(compactButtons).toHaveLength(1);

    const sceneButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("新品发布场景"));
    expect(sceneButtons).toHaveLength(1);
    expect(document.body.textContent).not.toContain("/campaign-launch");

    const skillButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("技能A"));
    expect(skillButtons).toHaveLength(1);
    expect(document.body.textContent).not.toContain("/skill-a");

    const curatedTaskButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("内容主稿生成"));
    expect(curatedTaskButtons).toHaveLength(1);
    expect(document.body.textContent).toContain(
      "去向：首版主稿会先进入当前内容，方便继续改写、拆成多平台版本。",
    );
    expect(document.body.textContent).toContain("下一步：改成多平台版本");
  });

  it("slash 面板中的已经沉淀的方法与继续上次做法应展示统一轻合同", async () => {
    act(() => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "skill-writer",
        usedAt: 1_712_345_678_900,
      });
    });

    const container = renderHarness({
      skills: [
        createSkill("写作助手", "skill-writer", true, {
          description: "本地补充技能",
          metadata: {
            lime_when_to_use: "当你需要复用本地写作方法时使用。",
            lime_argument_hint: "主题、受众与语气要求",
          },
        }),
        createSkill("脚本助手", "skill-script", true, {
          description: "脚本改写做法",
          metadata: {
            lime_when_to_use:
              "当你已经有一版脚本，想继续整理成更适合生成的做法时使用。",
            lime_argument_hint: "已有脚本、目标平台或表达方式",
          },
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("已经沉淀的方法");
    expect(document.body.textContent).toContain("继续上次做法");
    expect(document.body.textContent).toContain(
      "优先接着已经跑过的方法，通常比重新挑一条更省重来成本。",
    );
    expect(document.body.textContent).not.toContain("/skill-writer");
    expect(document.body.textContent).toContain(
      "写作助手 · 当你需要复用本地写作方法时使用。",
    );
    expect(document.body.textContent).toContain(
      "没命中上面的继续项时，再从这里换一条已经沉淀下来的方法。",
    );
    expect(document.body.textContent).toContain("脚本助手");
    expect(document.body.textContent).toContain("需要：主题、受众与语气要求");
    expect(document.body.textContent).toContain("交付：带着该方法进入生成");
  });

  it("slash 面板打开后新增本地 skill 使用记录时，应即时刷新继续上次做法分组", async () => {
    const container = renderHarness({
      skills: [
        createSkill("写作助手", "skill-writer", true, {
          description: "本地补充技能",
          metadata: {
            lime_when_to_use: "当你需要复用本地写作方法时使用。",
            lime_argument_hint: "主题、受众与语气要求",
          },
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).not.toContain("继续上次做法");

    await act(async () => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "skill-writer",
        usedAt: 1_712_345_678_901,
      });
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("继续上次做法");
    expect(document.body.textContent).not.toContain("/skill-writer");
    expect(document.body.textContent).toContain("写作助手");
  });

  it("选择最近使用的 slash 命令时应回填上次成功参数", async () => {
    const replayText = "src-tauri packages";
    act(() => {
      recordSlashEntryUsage({
        kind: "command",
        entryId: "review",
        usedAt: 1_712_345_678_900,
        replayText,
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain(`上次输入：${replayText}`);

    const recentCommandButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/review"));
    expect(recentCommandButton).toBeTruthy();

    act(() => {
      recentCommandButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith("/review src-tauri packages");
  });

  it("选择最近使用的 scene 时应优先回填上次成功参数，而不是再次挂起补参卡", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithXSceneEntry(), "bootstrap_sync");
      recordSlashEntryUsage({
        kind: "scene",
        entryId: "x-article-export",
        usedAt: 1_712_345_678_900,
        replayText: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      });
    });
    mockListServiceSkills.mockResolvedValueOnce([
      createXArticleSceneServiceSkill(),
    ]);

    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("X文章转存"));
    expect(recentSceneButton).toBeTruthy();

    act(() => {
      recentSceneButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      "/x文章转存 https://x.com/GoogleCloudTech/article/2033953579824758855",
    );
  });

  it("选择最近使用的结果模板时应预填上次启动参数与引用", async () => {
    act(() => {
      recordCuratedTaskTemplateUsage({
        templateId: "social-post-starter",
        launchInputValues: {
          subject_or_product: "上次的品牌 campaign 主线",
          target_audience: "海外增长负责人",
        },
        referenceMemoryIds: ["memory-idea-1"],
        referenceEntries: [
          {
            id: "memory-idea-1",
            title: "上次 campaign 参考",
            summary: "延续上次的品牌表达和平台拆分方式",
            category: "context",
            categoryLabel: "参考",
            tags: ["campaign", "品牌"],
          },
        ],
      });
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentCuratedTaskButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("内容主稿生成"));
    expect(recentCuratedTaskButton).toBeTruthy();
    expect(recentCuratedTaskButton?.textContent).toContain(
      "上次填写：主题或产品信息=上次的品牌 campaign 主线；目标受众=海外增长负责人",
    );
    expect(recentCuratedTaskButton?.textContent).toContain(
      "参考：上次 campaign 参考",
    );

    await act(async () => {
      recentCuratedTaskButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "已根据你上次启动 内容主稿生成 时的参数自动预填，可继续修改后进入生成。",
    );

    const subjectInput = document.body.querySelector(
      "#curated-task-social-post-starter-subject_or_product",
    ) as HTMLTextAreaElement | null;
    const audienceInput = document.body.querySelector(
      "#curated-task-social-post-starter-target_audience",
    ) as HTMLInputElement | null;

    expect(subjectInput?.value).toBe("上次的品牌 campaign 主线");
    expect(audienceInput?.value).toBe("海外增长负责人");
    expect(document.body.textContent).toContain(
      "已选择 1 条参考对象，本轮会一起带入生成。",
    );
  });

  it("slash 搜索时不应显示最近使用，而应回到搜索结果分组", async () => {
    act(() => {
      recordSlashEntryUsage({
        kind: "command",
        entryId: "compact",
        usedAt: 1_712_345_678_900,
      });
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/com");

    expect(document.body.textContent).not.toContain("最近使用");
    expect(document.body.textContent).toContain("工作台操作");
    expect(document.body.textContent).toContain("/compact");
  });

  it("slash 面板选择 Lime 命令时应回填到输入框", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/com");

    const commandButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/compact"));
    expect(commandButton).toBeTruthy();

    act(() => {
      commandButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/compact ");
  });

  it("slash 面板选择服务端 scene 时应回填场景命令", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    const sceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("新品发布场景"));
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.click();
      await Promise.resolve();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/campaign-launch ");
  });

  it("提供 onSelectInputCapability 时，slash 面板选择 scene 应走统一 capability 回调", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    const sceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("新品发布场景"));
    expect(sceneButton).toBeTruthy();

    act(() => {
      sceneButton?.click();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "runtime_scene",
        command: expect.objectContaining({
          key: "campaign-launch",
          commandPrefix: "/campaign-launch",
        }),
      }),
      undefined,
    );
    expect(onChangeSpy).toHaveBeenCalledWith("");
  });

  it("提供 onSelectInputCapability 时，最近使用的 scene 应带 replayText 走统一 capability 回调", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
      recordSlashEntryUsage({
        kind: "scene",
        entryId: "campaign-launch",
        usedAt: 1_712_345_678_900,
        replayText: "帮我做一版新品活动启动方案",
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("新品发布场景"));
    expect(recentSceneButton).toBeTruthy();

    act(() => {
      recentSceneButton?.click();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "runtime_scene",
        command: expect.objectContaining({
          key: "campaign-launch",
          commandPrefix: "/campaign-launch",
        }),
      }),
      { replayText: "帮我做一版新品活动启动方案" },
    );
    expect(onChangeSpy).toHaveBeenLastCalledWith("帮我做一版新品活动启动方案");
  });

  it("slash 面板选择带必填参数的 scene 时应交给父层 A2UI 补参接管", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithXSceneEntry(), "bootstrap_sync");
    });
    mockListServiceSkills.mockResolvedValueOnce([
      createXArticleSceneServiceSkill(),
    ]);

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/x文");

    const sceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("X文章转存"));
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.click();
      await Promise.resolve();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith({
      kind: "service_skill",
      skill: expect.objectContaining({
        id: "x-article-export",
        title: "X 文章转存",
      }),
    });
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("slash 面板选择已安装技能时应直接回填 slash skill", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/ski");

    const skillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("技能A"));
    expect(skillButton).toBeTruthy();

    act(() => {
      skillButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/skill-a ");
  });

  it("提供 onSelectInputCapability 时，slash 面板选择已安装技能应走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/ski");

    const skillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("技能A"));
    expect(skillButton).toBeTruthy();

    act(() => {
      skillButton?.click();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "installed_skill",
        skill: expect.objectContaining({
          key: "skill-a",
          name: "技能A",
        }),
      }),
      undefined,
    );
    expect(onChangeSpy).toHaveBeenCalledWith("");
  });

  it("提供 onSelectInputCapability 时，最近使用的已安装技能应带 replayText 走统一 capability 回调", async () => {
    act(() => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "skill-a",
        usedAt: 1_712_345_678_900,
        replayText: "整理最近发布计划",
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability =
      vi.fn<
        (
          capability: InputCapabilitySelection,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
      onSelectInputCapability,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSkillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("技能A"));
    expect(recentSkillButton).toBeTruthy();

    act(() => {
      recentSkillButton?.click();
    });

    expect(onSelectInputCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "installed_skill",
        skill: expect.objectContaining({
          key: "skill-a",
          name: "技能A",
        }),
      }),
      { replayText: "整理最近发布计划" },
    );
    expect(onChangeSpy).toHaveBeenLastCalledWith("整理最近发布计划");
  });

  it("提及面板应锚定在输入框正上方，并禁止自动翻转到下方", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 240,
      left: 120,
      top: 240,
      right: 720,
      bottom: 360,
      width: 600,
      height: 120,
      toJSON: () => ({}),
    });

    await typeAtAndWait(textarea);

    const anchor = document.body.querySelector(
      '[data-testid="mention-anchor"]',
    ) as HTMLDivElement | null;
    const popover = document.body.querySelector(
      '[data-testid="mention-popover-content"]',
    ) as HTMLDivElement | null;

    expect(anchor?.style.top).toBe("240px");
    expect(anchor?.style.left).toBe("120px");
    expect(anchor?.style.width).toBe("600px");
    expect(popover?.getAttribute("data-side")).toBe("top");
    expect(popover?.getAttribute("data-align")).toBe("start");
    expect(popover?.getAttribute("data-avoid-collisions")).toBe("false");
    expect(popover?.style.width).toBe("600px");
    expect(popover?.style.bottom).toBe("536px");
  });
});
