import React, { useRef, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterMention } from "./CharacterMention";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  saveSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import { filterMentionableServiceSkills } from "@/components/agent/chat/service-skills/entryAdapter";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type { BuiltinInputCommand } from "./builtinCommands";
import { recordMentionEntryUsage } from "./mentionEntryUsage";
import { recordSlashEntryUsage } from "./slashEntryUsage";

const mockListServiceSkills = vi.hoisted(() => vi.fn());

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
});

interface HarnessProps {
  characters?: Character[];
  skills?: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  syncValue?: boolean;
  onNavigateToSettings?: () => void;
  onChangeSpy?: (value: string) => void;
  onSelectBuiltinCommand?: (
    command: BuiltinInputCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
}

const Harness: React.FC<HarnessProps> = ({
  characters = [],
  skills = [],
  serviceSkills = [],
  syncValue = true,
  onNavigateToSettings,
  onChangeSpy,
  onSelectBuiltinCommand,
  onSelectServiceSkill,
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
        inputRef={inputRef}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          if (syncValue) {
            setValue(next);
          }
        }}
        onSelectBuiltinCommand={onSelectBuiltinCommand}
        onSelectServiceSkill={onSelectServiceSkill}
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

async function typeSlashAndWait(textarea: HTMLTextAreaElement, value = "/") {
  await act(async () => {
    await import("./CharacterMentionPanel");
  });

  typeSlash(textarea, value);
  await act(async () => {
    await Promise.resolve();
  });
}

function createSkill(name: string, key: string, installed: boolean): Skill {
  return {
    key,
    name,
    description: "测试技能",
    directory: `${key}-dir`,
    installed,
    sourceKind: "builtin",
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
          entry.kind !== "scene" ||
          entry.sceneKey !== "x-article-export",
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
    expect(document.body.textContent).toContain("@修图");
    expect(document.body.textContent).toContain("@重绘");
    expect(document.body.textContent).toContain("@视频");
    expect(document.body.textContent).toContain("@播报");
    expect(document.body.textContent).toContain("@素材");
    expect(document.body.textContent).toContain("@研报");
    expect(document.body.textContent).toContain("@读PDF");
    expect(document.body.textContent).toContain("@转写");
    expect(document.body.textContent).toContain("@链接解析");
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
          runnerLabel: "浏览器协助",
          runnerTone: "sky",
          runnerDescription: "进入真实浏览器执行只读采集。",
          actionLabel: "填写参数",
          groupKey: "github",
        }),
      ],
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain("推荐技能");
    expect(document.body.textContent).toContain("每日趋势摘要");
    expect(document.body.textContent).toContain("GitHub 仓库雷达");
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
    const onSelectBuiltinCommand = vi.fn<
      (command: BuiltinInputCommand, options?: { replayText?: string }) => void
    >();
    const container = renderHarness({
      onChangeSpy,
      onSelectBuiltinCommand,
    });
    const textarea = getTextarea(container);

    await typeAtAndWait(textarea);

    expect(document.body.textContent).toContain(`上次输入：${replayText}`);

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
          actionLabel: "填写参数",
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
          actionLabel: "填写参数",
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

  it("统一目录中的 scene 应出现在 slash 面板里", async () => {
    act(() => {
      saveSkillCatalog(buildCatalogWithSceneEntry(), "bootstrap_sync");
    });

    const container = renderHarness();
    const textarea = getTextarea(container);

    await typeSlashAndWait(textarea, "/camp");

    expect(document.body.textContent).toContain("场景组合");
    expect(document.body.textContent).toContain("/campaign-launch");
    expect(document.body.textContent).toContain(
      "把链接解析、配图和封面串成一条产品链路。",
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

  it("slash 面板选择带必填参数的 scene 时应交给服务技能弹窗接管", async () => {
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
