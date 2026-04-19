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
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import type { InputCapabilitySelection } from "./inputCapabilitySelection";
import { recordMentionEntryUsage } from "./mentionEntryUsage";
import { recordSlashEntryUsage } from "./slashEntryUsage";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  recordCuratedTaskTemplateUsage,
} from "../utils/curatedTaskTemplates";

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
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  onSelectBuiltinCommand?: (
    command: BuiltinInputCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectInputCapability?: (
    capability: InputCapabilitySelection,
    options?: { replayText?: string },
  ) => void;
  onSelectSkill?: (skill: Skill) => void;
  onSelectSceneCommand?: (
    command: RuntimeSceneSlashCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: Array<{
    id: string;
    title: string;
    summary: string;
    category: "identity" | "context" | "preference" | "experience" | "activity";
    categoryLabel: string;
    tags: string[];
  }>;
}

const Harness: React.FC<HarnessProps> = ({
  characters = [],
  skills = [],
  serviceSkills = [],
  serviceSkillGroups = [],
  syncValue = true,
  onNavigateToSettings,
  onChangeSpy,
  onSelectBuiltinCommand,
  onSelectInputCapability,
  onSelectSkill,
  onSelectSceneCommand,
  onSelectServiceSkill,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
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
        onSelectBuiltinCommand={onSelectBuiltinCommand}
        onSelectInputCapability={onSelectInputCapability}
        onSelectSkill={onSelectSkill}
        onSelectSceneCommand={onSelectSceneCommand}
        onSelectServiceSkill={onSelectServiceSkill}
        defaultCuratedTaskReferenceMemoryIds={
          defaultCuratedTaskReferenceMemoryIds
        }
        defaultCuratedTaskReferenceEntries={
          defaultCuratedTaskReferenceEntries
        }
        onNavigateToSettings={onNavigateToSettings}
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
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("带着启动信息进入生成"),
  ) as HTMLButtonElement | undefined;
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

  it("无角色和技能时仍应显示内建图片命令", async () => {
    const container = renderHarness({
      characters: [],
      skills: [],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("内建命令");
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

  it("提供 onSelectBuiltinCommand 时，选择配图命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
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

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "image_generate",
        commandPrefix: "@配图",
      }),
    );
  });

  it("提供 onSelectInputCapability 时，选择配图命令应走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability = vi.fn<
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

  it("提供 onSelectBuiltinCommand 时，选择海报命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@海报"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "poster_generate",
        commandPrefix: "@海报",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择渠道预览命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@渠道预览"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "channel_preview_runtime",
        commandPrefix: "@渠道预览",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择上传命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@上传"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "upload_runtime",
        commandPrefix: "@上传",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择发布合规命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@发布合规"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "publish_compliance",
        commandPrefix: "@发布合规",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择封面命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@封面"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "cover_generate",
        commandPrefix: "@封面",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择修图命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@修图"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "image_edit",
        commandPrefix: "@修图",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择重绘命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@重绘"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "image_variation",
        commandPrefix: "@重绘",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择视频命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@视频"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "video_generate",
        commandPrefix: "@视频",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择播报命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@播报"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "broadcast_generate",
        commandPrefix: "@播报",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择素材命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@素材"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "modal_resource_search",
        commandPrefix: "@素材",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择搜索命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@搜索"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "research",
        commandPrefix: "@搜索",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择深搜命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@深搜"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "deep_search",
        commandPrefix: "@深搜",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择研报命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@研报"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "research_report",
        commandPrefix: "@研报",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择竞品命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@竞品"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "competitor_research",
        commandPrefix: "@竞品",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择站点搜索命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@站点搜索"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "site_search",
        commandPrefix: "@站点搜索",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择读PDF命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@读PDF"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "read_pdf",
        commandPrefix: "@读PDF",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择总结命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@总结"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "summary",
        commandPrefix: "@总结",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择翻译命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@翻译"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "translation",
        commandPrefix: "@翻译",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择分析命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@分析"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "analysis",
        commandPrefix: "@分析",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择转写命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@转写"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "transcription_generate",
        commandPrefix: "@转写",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择链接解析命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@链接解析"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "url_parse",
        commandPrefix: "@链接解析",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择抓取命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@抓取"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "web_scrape",
        commandPrefix: "@抓取",
      }),
    );
  });

  it("提供 onSelectBuiltinCommand 时，选择网页读取命令应交给父组件接管", async () => {
    const onSelectBuiltinCommand =
      vi.fn<(command: BuiltinInputCommand) => void>();
    const container = renderHarness({
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    const builtinButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("@网页读取"));
    expect(builtinButton).toBeTruthy();

    act(() => {
      builtinButton?.click();
    });

    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "webpage_read",
        commandPrefix: "@网页读取",
      }),
    );
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

    expect(document.body.textContent).toContain("推荐技能");
    expect(document.body.textContent).toContain("每日趋势摘要");
    expect(document.body.textContent).toContain("GitHub 仓库雷达");
    expect(document.body.textContent).toContain("需要：当前无必填信息");
    expect(document.body.textContent).toContain("交付：趋势摘要 + 调度建议");
    expect(document.body.textContent).toContain("需要：仓库关键词");
  });

  it("最近使用的服务技能应优先显示在独立分组，且不在技能组里重复", async () => {
    const recentSkill = createServiceSkill({
      id: "recent-trend-briefing",
      title: "最近趋势摘要",
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

    expect(document.body.textContent).toContain("最近使用");
    expect(document.body.textContent).toContain("推荐技能");

    const recentButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("最近趋势摘要"));
    expect(recentButtons).toHaveLength(1);

    const regularButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("常规趋势摘要"));
    expect(regularButtons).toHaveLength(1);
  });

  it("@ 空查询时应优先显示最近使用的内建命令，且不在内建命令分组重复", async () => {
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

    expect(document.body.textContent).toContain("最近使用");

    const recentCommandButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("@搜索"));
    expect(recentCommandButtons).toHaveLength(1);
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
    const onSelectBuiltinCommand =
      vi.fn<
        (
          command: BuiltinInputCommand,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectBuiltinCommand,
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
    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "research",
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
    const onSelectBuiltinCommand =
      vi.fn<
        (
          command: BuiltinInputCommand,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectBuiltinCommand,
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
    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "research",
        commandPrefix: "@搜索",
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
    const onSelectBuiltinCommand =
      vi.fn<
        (
          command: BuiltinInputCommand,
          options?: { replayText?: string },
        ) => void
      >();
    const container = renderHarness({
      onChangeSpy,
      onSelectBuiltinCommand,
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
    expect(onSelectBuiltinCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "research",
        commandPrefix: "@搜索",
      }),
      expect.objectContaining({
        replayText,
      }),
    );
  });

  it("@ 搜索时不应显示最近使用，而应回到普通命令结果", async () => {
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

    expect(document.body.textContent).not.toContain("最近使用");
    expect(document.body.textContent).toContain("内建命令");
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
      ],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("已安装技能");
    expect(document.body.textContent).toContain("写作助手");
    expect(document.body.textContent).toContain("当你需要复用本地写作方法时使用。");
    expect(document.body.textContent).toContain("需要：主题、受众与语气要求");
    expect(document.body.textContent).toContain("交付：带着该方法进入生成主执行面");
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

    expect(document.body.textContent).toContain("最近使用");
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

    expect(document.body.textContent).not.toContain("最近使用");
    expect(document.body.textContent).not.toContain("推荐技能");
    expect(document.body.textContent).toContain("技能组 · GitHub");
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
    expect(bodyText).toContain("技能组 · 创作中台");
    expect(bodyText).toContain("技能组 · 通用技能");
    expect(bodyText).not.toContain("技能组 · creative-workbench");
    expect(bodyText.indexOf("技能组 · 创作中台")).toBeLessThan(
      bodyText.indexOf("技能组 · 通用技能"),
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

    expect(document.body.textContent).toContain("内建命令");
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

  it("提供 onSelectServiceSkill 时，选择服务技能应交给父组件接管", async () => {
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const onChangeSpy = vi.fn<(value: string) => void>();
    const serviceSkill = createServiceSkill();
    const container = renderHarness({
      serviceSkills: [serviceSkill],
      onSelectServiceSkill,
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
    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkill);
  });

  it("未提供 onSelectSkill 时，选择已安装技能应回填到输入框", async () => {
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

  it("输入 / 时应显示 Codex slash 命令列表", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("快捷操作");
    expect(document.body.textContent).toContain("/compact");
    expect(document.body.textContent).toContain("/review");
    expect(document.body.textContent).not.toContain("/quit");
  });

  it("统一目录中的结果模板应出现在 slash 面板里", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    expect(document.body.textContent).toContain("结果模板");
    expect(document.body.textContent).toContain("/campaign-launch");
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
    const templateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("每日趋势摘要"));
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    expect(document.body.textContent).toContain("先补最少启动信息，再统一进入生成主执行面。");
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

  it("提供 onSelectInputCapability 时，slash 面板选择结果模板应在 launcher 确认后走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability = vi.fn<
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
      "已选择 1 条灵感引用，本轮会一起带入生成。",
    );
  });

  it("搜索未接入的 slash 命令时，应单独显示暂未接入分组", async () => {
    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/qui");

    expect(document.body.textContent).not.toContain("快捷操作");
    expect(document.body.textContent).toContain("暂未接入");
    expect(document.body.textContent).toContain("/quit");
  });

  it("slash 空查询时应优先显示最近使用，且不在原分组重复", async () => {
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

    expect(document.body.textContent).toContain("最近使用");

    const compactButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("/compact"));
    expect(compactButtons).toHaveLength(1);

    const sceneButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("/campaign-launch"));
    expect(sceneButtons).toHaveLength(1);

    const skillButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("技能A"));
    expect(skillButtons).toHaveLength(1);

    const curatedTaskButtons = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("内容主稿生成"));
    expect(curatedTaskButtons).toHaveLength(1);
  });

  it("slash 面板中的已安装技能与最近 skill 应展示统一轻合同", async () => {
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
      ],
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    expect(document.body.textContent).toContain("最近使用");
    expect(document.body.textContent).toContain("/skill-writer");
    expect(document.body.textContent).toContain(
      "写作助手 · 当你需要复用本地写作方法时使用。",
    );
    expect(document.body.textContent).toContain("需要：主题、受众与语气要求");
    expect(document.body.textContent).toContain("交付：带着该方法进入生成主执行面");
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
        replayText:
          "https://x.com/GoogleCloudTech/article/2033953579824758855",
      });
    });
    mockListServiceSkills.mockResolvedValueOnce([
      createXArticleSceneServiceSkill(),
    ]);

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const container = renderHarness({
      onChangeSpy,
      onSelectServiceSkill,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/x文章转存"));
    expect(recentSceneButton).toBeTruthy();

    act(() => {
      recentSceneButton?.click();
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      "/x文章转存 https://x.com/GoogleCloudTech/article/2033953579824758855",
    );
    expect(onSelectServiceSkill).not.toHaveBeenCalled();
  });

  it("提供 onSelectSkill 时，最近使用的 slash skill 应回填 replayText 并切到 active capability", async () => {
    act(() => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "skill-a",
        usedAt: 1_712_345_678_900,
        replayText: "整理最近发布计划",
      });
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectSkill = vi.fn<(skill: Skill) => void>();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
      onSelectSkill,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSkillButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/skill-a"));
    expect(recentSkillButton).toBeTruthy();

    act(() => {
      recentSkillButton?.click();
    });

    expect(onSelectSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "skill-a",
        name: "技能A",
      }),
    );
    expect(onChangeSpy).toHaveBeenLastCalledWith("整理最近发布计划");
  });

  it("提供 onSelectSceneCommand 时，最近使用的 scene 应回填 replayText 并切到 active capability", async () => {
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
    const onSelectSceneCommand = vi.fn<
      (
        command: RuntimeSceneSlashCommand,
        options?: { replayText?: string },
      ) => void
    >();
    const container = renderHarness({
      onChangeSpy,
      onSelectSceneCommand,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea);

    const recentSceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/campaign-launch"));
    expect(recentSceneButton).toBeTruthy();

    act(() => {
      recentSceneButton?.click();
    });

    expect(onSelectSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "campaign-launch",
        commandPrefix: "/campaign-launch",
      }),
      { replayText: "帮我做一版新品活动启动方案" },
    );
    expect(onChangeSpy).toHaveBeenLastCalledWith("帮我做一版新品活动启动方案");
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
    expect(document.body.textContent).toContain("Lime 命令");
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
    ).find((button) => button.textContent?.includes("/campaign-launch"));
    expect(sceneButton).toBeTruthy();

    act(() => {
      sceneButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/campaign-launch ");
  });

  it("提供 onSelectSceneCommand 时，slash 面板选择 scene 应切换为 active capability 而不是回填命令前缀", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectSceneCommand = vi.fn<
      (command: RuntimeSceneSlashCommand) => void
    >();
    const container = renderHarness({
      onChangeSpy,
      onSelectSceneCommand,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    const sceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/campaign-launch"));
    expect(sceneButton).toBeTruthy();

    act(() => {
      sceneButton?.click();
    });

    expect(onSelectSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "campaign-launch",
        commandPrefix: "/campaign-launch",
      }),
    );
    expect(onChangeSpy).toHaveBeenCalledWith("");
  });

  it("提供 onSelectInputCapability 时，slash 面板选择 scene 应走统一 capability 回调", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability = vi.fn<
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
    ).find((button) => button.textContent?.includes("/campaign-launch"));
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

  it("slash 面板选择带必填参数的 scene 时应交给父层 A2UI 补参接管", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithXSceneEntry(), "bootstrap_sync");
    });
    mockListServiceSkills.mockResolvedValueOnce([
      createXArticleSceneServiceSkill(),
    ]);

    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const container = renderHarness({
      onChangeSpy,
      onSelectServiceSkill,
    });
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/x文");

    const sceneButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("/x文章转存"));
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.click();
      await Promise.resolve();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "x-article-export",
        title: "X 文章转存",
      }),
    );
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

  it("提供 onSelectSkill 时，slash 面板选择已安装技能应切换为 active capability 而不是回填 slash skill", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectSkill = vi.fn<(skill: Skill) => void>();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
      onSelectSkill,
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

    expect(onSelectSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "skill-a",
        name: "技能A",
      }),
    );
    expect(onChangeSpy).toHaveBeenCalledWith("");
  });

  it("提供 onSelectInputCapability 时，slash 面板选择已安装技能应走统一 capability 回调", async () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const onSelectInputCapability = vi.fn<
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
