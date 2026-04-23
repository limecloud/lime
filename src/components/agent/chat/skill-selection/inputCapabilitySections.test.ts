import { beforeEach, describe, expect, it } from "vitest";
import type { CodexSlashCommandDefinition } from "../commands";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import { buildInputCapabilitySections } from "./inputCapabilitySections";

function createBuiltinCommand(
  overrides: Partial<BuiltinInputCommand> & Pick<BuiltinInputCommand, "key">,
): BuiltinInputCommand {
  return {
    label: overrides.key,
    mentionLabel: overrides.key,
    commandPrefix: `@${overrides.key}`,
    description: `${overrides.key} 描述`,
    aliases: [],
    ...overrides,
  };
}

function createSlashCommand(
  overrides: Partial<CodexSlashCommandDefinition> &
    Pick<CodexSlashCommandDefinition, "key" | "commandPrefix" | "kind">,
): CodexSlashCommandDefinition {
  return {
    commandName: overrides.key,
    label: overrides.key,
    description: `${overrides.key} 描述`,
    aliases: [],
    support: "supported",
    ...overrides,
  };
}

function buildEmptyParams() {
  return {
    mentionQuery: "",
    builtinCommands: [] as BuiltinInputCommand[],
    slashCommands: [] as CodexSlashCommandDefinition[],
    sceneCommands: [] as RuntimeSceneSlashCommand[],
    mentionServiceSkills: [],
    serviceSkillGroups: [],
    filteredCharacters: [],
    installedSkills: [],
    availableSkills: [],
    projectId: undefined,
    sessionId: undefined,
    referenceEntries: undefined,
  };
}

describe("buildInputCapabilitySections", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("mention 面板应按业务能力分组，而不是回退到内建命令总表", () => {
    const sections = buildInputCapabilitySections({
      ...buildEmptyParams(),
      mode: "mention",
      builtinCommands: [
        createBuiltinCommand({
          key: "research",
          label: "搜索",
          commandPrefix: "@搜索",
        }),
        createBuiltinCommand({
          key: "image_generate",
          label: "配图",
          commandPrefix: "@配图",
        }),
        createBuiltinCommand({
          key: "publish_runtime",
          label: "发布",
          commandPrefix: "@发布",
        }),
      ],
    });

    const headings = sections.map((section) => section.heading);
    expect(headings).toContain("搜索 / 读取");
    expect(headings).toContain("生成 / 表达");
    expect(headings).toContain("预览 / 发布");
    expect(headings).not.toContain("内建命令");
  });

  it("slash 空查询应先收成先拿结果与工作台操作，不默认展开提示命令和状态帮助", () => {
    const sections = buildInputCapabilitySections({
      ...buildEmptyParams(),
      mode: "slash",
      slashCommands: [
        createSlashCommand({
          key: "compact",
          commandPrefix: "/compact",
          kind: "local_action",
          label: "压缩上下文",
        }),
        createSlashCommand({
          key: "clear",
          commandPrefix: "/clear",
          kind: "local_action",
          label: "清空任务",
        }),
        createSlashCommand({
          key: "new",
          commandPrefix: "/new",
          kind: "local_action",
          label: "新建任务",
        }),
        createSlashCommand({
          key: "review",
          commandPrefix: "/review",
          kind: "prompt_action",
          label: "代码审查",
        }),
        createSlashCommand({
          key: "help",
          commandPrefix: "/help",
          kind: "info",
          label: "命令帮助",
        }),
      ],
    });

    const headings = sections.map((section) => section.heading);
    expect(headings).toContain("先拿结果");
    expect(headings).toContain("工作台操作");
    expect(headings).not.toContain("提示命令");
    expect(headings).not.toContain("状态 / 帮助");
    expect(headings).not.toContain("快捷操作");
    expect(headings).not.toContain("Lime 命令");

    const workspaceSection = sections.find(
      (section) => section.heading === "工作台操作",
    );
    expect(workspaceSection?.items.map((item) => item.title)).toEqual([
      "新建任务",
      "清空任务",
      "压缩上下文",
    ]);
    expect(workspaceSection?.items.map((item) => item.kindLabel)).toEqual([
      "工作台操作 · /new",
      "工作台操作 · /clear",
      "工作台操作 · /compact",
    ]);
  });

  it("slash 搜索时仍应按工作台命令类型展开匹配结果", () => {
    const sections = buildInputCapabilitySections({
      ...buildEmptyParams(),
      mode: "slash",
      mentionQuery: "工作台",
      slashCommands: [
        createSlashCommand({
          key: "new",
          commandPrefix: "/new",
          kind: "local_action",
          label: "工作台入口",
        }),
        createSlashCommand({
          key: "review",
          commandPrefix: "/review",
          kind: "prompt_action",
          label: "工作台复盘",
        }),
        createSlashCommand({
          key: "help",
          commandPrefix: "/help",
          kind: "info",
          label: "工作台帮助",
        }),
      ],
    });

    const headings = sections.map((section) => section.heading);
    expect(headings).toContain("工作台操作");
    expect(headings).toContain("提示命令");
    expect(headings).toContain("状态 / 帮助");
  });
});
