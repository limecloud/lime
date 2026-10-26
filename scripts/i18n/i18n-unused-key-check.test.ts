import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatUnusedI18nKeyReport,
  runCli,
  scanUnusedI18nKeys,
} from "./i18n-unused-key-check";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lime-i18n-unused-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(
  root: string,
  relativePath: string,
  content: string,
): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeResource(
  root: string,
  locale: string,
  namespace: string,
  resource: Record<string, unknown>,
): void {
  writeFile(
    root,
    `resources/${locale}/${namespace}.json`,
    `${JSON.stringify(resource, null, 2)}\n`,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("i18n unused key scan", () => {
  it("应识别显式命名空间 key 且继续报告未引用资源", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "settings", {
      "settings.channels.config.open": "开放",
      "settings.channels.config.unused": "未引用",
    });
    writeFile(
      root,
      "src/components/Channels.tsx",
      'export const label = t("settings:settings.channels.config.open");\n',
    );
    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
      protectedPrefixes: [],
    });
    expect(result.referencedKeys).toEqual(["settings.channels.config.open"]);
    expect(result.unusedKeys).toEqual([
      { namespace: "settings", key: "settings.channels.config.unused" },
    ]);
  });

  it("应报告未被生产源码字面量引用的 source locale key", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "common", {
      "common.cancel": "取消",
      "common.dynamic.action": "动态操作",
      "common.save": "保存",
    });
    writeFile(
      root,
      "src/components/SaveButton.tsx",
      [
        "export function SaveButton({ t }: { t: (key: string) => string }) {",
        '  return <button>{t("common.save")}</button>;',
        "}",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/components/SaveButton.test.tsx",
      'expect("common.cancel").toBeTruthy();\n',
    );

    const result = scanUnusedI18nKeys({
      protectedPrefixes: ["common.dynamic."],
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual(["common.save"]);
    expect(result.unusedKeys).toEqual([
      { key: "common.cancel", namespace: "common" },
    ]);
    expect(result.protectedKeys).toEqual([
      { key: "common.dynamic.action", namespace: "common" },
    ]);
    expect(result.namespaceSummaries).toEqual([
      expect.objectContaining({
        namespace: "common",
        resourceKeyCount: 3,
        referencedKeyCount: 1,
        protectedKeyCount: 1,
        unusedKeyCount: 1,
      }),
    ]);
  });

  it("应识别 property-call 形式的 t 调用", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "common", {
      "common.save": "保存",
      "common.cancel": "取消",
    });
    writeFile(
      root,
      "src/components/SaveButton.tsx",
      [
        "export function SaveButton({ i18n }: { i18n: { t: (key: string) => string } }) {",
        '  return <button>{i18n.t("common.save")}</button>;',
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual(["common.save"]);
    expect(result.unusedKeys).toEqual([
      { key: "common.cancel", namespace: "common" },
    ]);
  });

  it("应从 t 模板字符串中推断动态 key pattern 并保护匹配 key", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "settings", {
      "settings.theme.dark.label": "深色",
      "settings.theme.light.label": "浅色",
      "settings.theme.system.label": "系统",
      "settings.theme.static": "静态",
    });
    writeFile(
      root,
      "src/components/ThemeLabel.tsx",
      [
        'export function ThemeLabel({ mode }: { mode: "dark" | "light" }) {',
        "  return <span>{t(`settings.theme.${mode}.label` as never)}</span>;",
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.dynamicKeyPatterns).toEqual([
      expect.objectContaining({
        pattern: "^settings\\.theme\\.(.+?)\\.label$",
      }),
    ]);
    expect(result.dynamicKeyPatterns[0]?.source).toMatch(
      /src\/components\/ThemeLabel\.tsx:2$/,
    );
    expect(result.protectedKeys).toEqual([
      { key: "settings.theme.dark.label", namespace: "settings" },
      { key: "settings.theme.light.label", namespace: "settings" },
      { key: "settings.theme.system.label", namespace: "settings" },
    ]);
    expect(result.unusedKeys).toEqual([
      { key: "settings.theme.static", namespace: "settings" },
    ]);
  });

  it("应识别 agent chat copy helper 的静态 key 前缀", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agent", {
      "agentChat.toolCall.memoryEvidence.path": "路径",
      "agentChat.toolCall.memoryEvidence.unused": "未使用",
    });
    writeFile(
      root,
      "src/components/MemoryEvidence.ts",
      [
        'import { resolveRequiredAgentChatCopy } from "./agentChatCopy";',
        "export function MemoryEvidence() {",
        '  return resolveRequiredAgentChatCopy("toolCall.memoryEvidence.path");',
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual([
      "agentChat.toolCall.memoryEvidence.path",
    ]);
    expect(result.unusedKeys).toEqual([
      {
        key: "agentChat.toolCall.memoryEvidence.unused",
        namespace: "agent",
      },
    ]);
  });

  it("应把 agent chat partial key 视为真实资源 key 引用", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentRuntime", {
      "agentChat.toolCall.label.fileRead": "文件读取",
      "agentChat.toolCall.label.fileWrite": "文件写入",
      "agentChat.toolCall.userFacing.fileRead": "文件读取",
    });
    writeFile(
      root,
      "src/components/toolDisplayCopy.ts",
      [
        "const TOOL_DISPLAY_LABEL_KEYS = {",
        '  "文件读取": "toolCall.label.fileRead",',
        "};",
        'const OTHER_KEY = "toolCall.userFacing.fileRead";',
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual([
      "agentChat.toolCall.label.fileRead",
      "agentChat.toolCall.userFacing.fileRead",
    ]);
    expect(result.unusedKeys).toEqual([
      {
        key: "agentChat.toolCall.label.fileWrite",
        namespace: "agentRuntime",
      },
    ]);
  });

  it("应识别 process summary helper 派生的 WithSubject key", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentMessageList", {
      "agentChat.toolCall.processSummary.generic.read": "已读取",
      "agentChat.toolCall.processSummary.generic.readWithSubject":
        "已读取 {{subject}}",
      "agentChat.toolCall.processSummary.generic.write": "已写入",
    });
    writeFile(
      root,
      "src/components/toolProcessSummary.ts",
      [
        "function demo(subject: string | null) {",
        "  return resolveProcessSummaryCopy(",
        '    "toolCall.processSummary.generic.read",',
        "    subject,",
        "  );",
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual([
      "agentChat.toolCall.processSummary.generic.read",
      "agentChat.toolCall.processSummary.generic.readWithSubject",
    ]);
    expect(result.unusedKeys).toEqual([
      {
        key: "agentChat.toolCall.processSummary.generic.write",
        namespace: "agentMessageList",
      },
    ]);
  });

  it("应识别 phased process summary helper 派生的 pre/post key", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentMessageList", {
      "agentChat.toolCall.processSummary.vision.view.post": "已查看图片",
      "agentChat.toolCall.processSummary.vision.view.postWithSubject":
        "已查看 {{subject}}",
      "agentChat.toolCall.processSummary.vision.view.pre": "先查看图片",
      "agentChat.toolCall.processSummary.vision.view.preWithSubject":
        "先查看 {{subject}}",
      "agentChat.toolCall.processSummary.vision.analyze.pre": "先分析图片",
    });
    writeFile(
      root,
      "src/components/toolProcessSummary.ts",
      [
        'function demo(phase: "pre" | "post", subject: string | null) {',
        "  return resolvePhasedProcessSummaryCopy(",
        '    "toolCall.processSummary.vision.view",',
        "    phase,",
        "    subject,",
        "  );",
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.referencedKeys).toEqual([
      "agentChat.toolCall.processSummary.vision.view.post",
      "agentChat.toolCall.processSummary.vision.view.postWithSubject",
      "agentChat.toolCall.processSummary.vision.view.pre",
      "agentChat.toolCall.processSummary.vision.view.preWithSubject",
    ]);
    expect(result.unusedKeys).toEqual([
      {
        key: "agentChat.toolCall.processSummary.vision.analyze.pre",
        namespace: "agentMessageList",
      },
    ]);
  });

  it("应识别 agent chat copy helper 的模板动态 key 前缀", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agent", {
      "agentChat.toolCall.action.read.completed": "已读取",
      "agentChat.toolCall.action.read.running": "正在读取",
      "agentChat.toolCall.action.write.completed": "已写入",
      "agentChat.toolCall.label.generic": "工具",
    });
    writeFile(
      root,
      "src/components/ToolAction.ts",
      [
        'import { resolveRequiredAgentChatCopy } from "./agentChatCopy";',
        "export function ToolAction(action: string, status: string) {",
        "  return resolveRequiredAgentChatCopy(`toolCall.action.${action}.${status}`);",
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.dynamicKeyPatterns).toEqual([
      expect.objectContaining({
        pattern: "^agentChat\\.toolCall\\.action\\.(.+?)\\.(.+?)$",
      }),
    ]);
    expect(result.protectedKeys).toEqual([
      {
        key: "agentChat.toolCall.action.read.completed",
        namespace: "agent",
      },
      {
        key: "agentChat.toolCall.action.read.running",
        namespace: "agent",
      },
      {
        key: "agentChat.toolCall.action.write.completed",
        namespace: "agent",
      },
    ]);
    expect(result.unusedKeys).toEqual([
      {
        key: "agentChat.toolCall.label.generic",
        namespace: "agent",
      },
    ]);
  });

  it("应识别 useMemo 包装后的 t 别名动态 key", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentMessageList", {
      "agentChat.sidebar.heading.recentConversations": "最近对话",
      "agentChat.sidebar.heading.tasks": "任务",
      "agentChat.sidebar.static": "静态",
    });
    writeFile(
      root,
      "src/components/ChatSidebar.tsx",
      [
        "type AgentNamespaceTranslation = (key: string) => string;",
        "export function ChatSidebar({ keyName }: { keyName: string }) {",
        "  const agentT = useMemo(() => t as unknown as AgentNamespaceTranslation, [t]);",
        "  return agentT(`agentChat.sidebar.${keyName}`);",
        "}",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.dynamicKeyPatterns).toEqual([
      expect.objectContaining({
        pattern: "^agentChat\\.sidebar\\.(.+?)$",
      }),
    ]);
    expect(result.protectedKeys).toEqual([
      {
        key: "agentChat.sidebar.heading.recentConversations",
        namespace: "agentMessageList",
      },
      {
        key: "agentChat.sidebar.heading.tasks",
        namespace: "agentMessageList",
      },
      {
        key: "agentChat.sidebar.static",
        namespace: "agentMessageList",
      },
    ]);
    expect(result.unusedKeys).toEqual([]);
  });

  it("应识别文件内 const 前缀并推断动态 key pattern", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentRuntime", {
      "agentChat.threadReliability.diagnostic.value.waitingPermission":
        "等待权限",
      "agentChat.threadReliability.diagnostic.value.failed": "失败",
      "agentChat.threadReliability.diagnostic.value.success": "成功",
      "agentChat.threadReliability.diagnostic.value.extra": "额外",
    });
    writeFile(
      root,
      "src/components/agent/chat/utils/threadReliabilityDiagnosticText.ts",
      [
        'const DIAGNOSTIC_I18N_PREFIX = "agentChat.threadReliability.diagnostic.";',
        "function tr(t: (key: string) => string, key: string) {",
        "  return t(`${DIAGNOSTIC_I18N_PREFIX}${key}`);",
        "}",
        "export const demo = tr;",
        "",
      ].join("\n"),
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.dynamicKeyPatterns).toEqual([
      expect.objectContaining({
        pattern: "^agentChat\\.threadReliability\\.diagnostic\\.(.+?)$",
      }),
    ]);
    expect(result.protectedKeys).toEqual([
      {
        key: "agentChat.threadReliability.diagnostic.value.extra",
        namespace: "agentRuntime",
      },
      {
        key: "agentChat.threadReliability.diagnostic.value.failed",
        namespace: "agentRuntime",
      },
      {
        key: "agentChat.threadReliability.diagnostic.value.success",
        namespace: "agentRuntime",
      },
      {
        key: "agentChat.threadReliability.diagnostic.value.waitingPermission",
        namespace: "agentRuntime",
      },
    ]);
  });

  it("应默认保护已确认的动态家族前缀", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "agentTeamWorkspace", {
      "agentChat.agentUiProjection.eventType.task.changed": "Task update",
      "agentChat.agentUiProjection.eventType.task.created": "Task created",
      "agentChat.agentUiProjection.eventType.task.deleted": "Task deleted",
      "agentChat.agentUiProjection.eventType.task.updated": "Task updated",
    });
    writeResource(root, "zh-CN", "workspace", {
      "workspace.articleWorkspace.action.revise": "改写",
      "workspace.articleWorkspace.actionPrompt.revise": "请改写",
      "workspace.document.editor.slashCommand.items.heading1.description":
        "Heading description",
      "workspace.document.editor.slashCommand.items.heading1.title": "Heading",
      "workspace.document.editor.slashCommand.prompt.imageUrl": "Image URL",
    });

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });

    expect(result.protectedKeys).toEqual([
      {
        key: "agentChat.agentUiProjection.eventType.task.changed",
        namespace: "agentTeamWorkspace",
      },
      {
        key: "agentChat.agentUiProjection.eventType.task.created",
        namespace: "agentTeamWorkspace",
      },
      {
        key: "agentChat.agentUiProjection.eventType.task.deleted",
        namespace: "agentTeamWorkspace",
      },
      {
        key: "agentChat.agentUiProjection.eventType.task.updated",
        namespace: "agentTeamWorkspace",
      },
      {
        key: "workspace.articleWorkspace.action.revise",
        namespace: "workspace",
      },
      {
        key: "workspace.articleWorkspace.actionPrompt.revise",
        namespace: "workspace",
      },
      {
        key: "workspace.document.editor.slashCommand.items.heading1.description",
        namespace: "workspace",
      },
      {
        key: "workspace.document.editor.slashCommand.items.heading1.title",
        namespace: "workspace",
      },
      {
        key: "workspace.document.editor.slashCommand.prompt.imageUrl",
        namespace: "workspace",
      },
    ]);
    expect(result.unusedKeys).toEqual([]);
    expect(result.namespaceSummaries).toEqual([
      expect.objectContaining({
        namespace: "workspace",
        resourceKeyCount: 5,
        referencedKeyCount: 0,
        protectedKeyCount: 5,
        unusedKeyCount: 0,
      }),
      expect.objectContaining({
        namespace: "agentTeamWorkspace",
        resourceKeyCount: 4,
        referencedKeyCount: 0,
        protectedKeyCount: 4,
        unusedKeyCount: 0,
      }),
    ]);
  });

  it("应输出 JSON 报告并在 --check 命中 unused 时返回非零", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "settings", {
      "settings.used": "已使用",
      "settings.unused": "未使用",
    });
    writeFile(
      root,
      "src/settings/Page.tsx",
      'export const titleKey = "settings.used";\n',
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });
    const report = JSON.parse(formatUnusedI18nKeyReport(result, "json")) as {
      dynamicKeyPatterns: Array<{ pattern: string; source: string }>;
      summary: { unusedKeyCount: number };
      unusedKeysByNamespace: Record<string, string[]>;
    };

    expect(report.summary.unusedKeyCount).toBe(1);
    expect(report.dynamicKeyPatterns).toEqual([]);
    expect(report.namespaceSummaries).toEqual([
      expect.objectContaining({
        namespace: "settings",
        unusedKeyCount: 1,
      }),
    ]);
    expect(report.unusedKeysByNamespace.settings).toEqual(["settings.unused"]);

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const exitCode = runCli([
      "--check",
      "--format",
      "json",
      "--resources-dir",
      path.join(root, "resources"),
      "--source-dir",
      path.join(root, "src"),
    ]);

    expect(exitCode).toBe(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(writeSpy.mock.calls[0]?.[0] ?? ""))).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          unusedKeyCount: 1,
        }),
        namespaceSummaries: expect.arrayContaining([
          expect.objectContaining({
            namespace: "settings",
          }),
        ]),
      }),
    );
  });

  it("应在 text 报告中显示 namespace 热点", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "common", {
      "common.save": "保存",
      "common.cancel": "取消",
    });
    writeFile(
      root,
      "src/common/Page.tsx",
      'export const key = "common.save";\n',
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });
    const text = formatUnusedI18nKeyReport(result, "text");

    expect(text).toContain("[i18n:unused] namespace 热点：");
    expect(text).toContain("common: total=2 referenced=1 protected=0 unused=1");
  });

  it("应在报告中显示 namespace 内前缀家族热点", () => {
    const root = createTempDir();
    writeResource(root, "zh-CN", "common", {
      "common.family.alpha.one": "A1",
      "common.family.alpha.two": "A2",
      "common.family.beta.one": "B1",
      "common.family.beta.two": "B2",
    });
    writeFile(
      root,
      "src/components/common/Page.tsx",
      'export const title = "common.family.beta.one";\n',
    );

    const result = scanUnusedI18nKeys({
      resourcesDir: path.join(root, "resources"),
      sourceDirs: [path.join(root, "src")],
    });
    const report = JSON.parse(formatUnusedI18nKeyReport(result, "json")) as {
      unusedKeyFamiliesByNamespace: Record<
        string,
        Array<{ prefix: string; count: number }>
      >;
    };
    const families = report.unusedKeyFamiliesByNamespace.common;

    expect(families).toEqual([
      expect.objectContaining({
        prefix: "common.family.alpha",
        count: 2,
      }),
      expect.objectContaining({
        prefix: "common.family.beta",
        count: 1,
      }),
    ]);

    const text = formatUnusedI18nKeyReport(result, "text");
    expect(text).toContain("[i18n:unused] 未引用 key 家族热点：");
    expect(text).toContain("common:");
    expect(text).toContain("common.family.alpha: 2");
  });
});
