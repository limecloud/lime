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

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
  },
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

interface HarnessProps {
  characters?: Character[];
  skills?: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  syncValue?: boolean;
  onNavigateToSettings?: () => void;
  onChangeSpy?: (value: string) => void;
  onSelectBuiltinCommand?: (command: BuiltinInputCommand) => void;
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

    expect(document.body.textContent).toContain("技能组 · 通用技能");
    expect(document.body.textContent).toContain("技能组 · GitHub");
    expect(document.body.textContent).toContain("每日趋势摘要");
    expect(document.body.textContent).toContain("GitHub 仓库雷达");
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

    expect(document.body.textContent).toContain("Lime 命令");
    expect(document.body.textContent).toContain("/compact");
    expect(document.body.textContent).toContain("/review");
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
