import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { setImmediate as yieldIO } from "node:timers/promises";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const EXPORT_CLIENT_SOURCE = "src/lib/api/agentRuntime/exportClient.ts";
const CURRENT_HARNESS_PANEL_SOURCE =
  "src/components/agent/chat/components/HarnessStatusPanel.tsx";
const REGISTERED_SKILLS_PANEL_SOURCE =
  "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx";
const PRODUCTION_SCAN_ROOTS = ["src", "packages"];
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function repoRelative(path: string): string {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function extensionOf(path: string): string {
  const match = path.match(/\.[^.]+$/u);
  return match?.[0] ?? "";
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const stat = entry.isSymbolicLink() ? statSync(fullPath) : entry;
    if (stat.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (stat.isFile() && SOURCE_EXTENSIONS.has(extensionOf(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isProductionSource(path: string): boolean {
  return (
    !path.includes("/__tests__/") &&
    !path.includes("/fixtures/") &&
    !path.includes("/src/lib/governance/") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx") &&
    !path.endsWith(".spec.ts") &&
    !path.endsWith(".spec.tsx")
  );
}

function extractFunctionBody(source: string, functionName: string): string {
  const sourceFile = ts.createSourceFile(
    EXPORT_CLIENT_SOURCE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let body = "";
  function visit(node: ts.Node): void {
    if (body) {
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      body = node.body?.getText(sourceFile) ?? "";
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return body;
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}

function assertInOrder(source: string, snippets: string[]): void {
  let cursor = 0;
  for (const snippet of snippets) {
    const index = source.indexOf(snippet, cursor);
    expect(index, `缺少或乱序片段：${snippet}`).toBeGreaterThanOrEqual(0);
    cursor = index + snippet.length;
  }
}

describe("Agent runtime export boundary", () => {
  it("Codex 对齐的 GUI surface 不得重新触发 Lime 派生 evidence export", () => {
    for (const path of [
      CURRENT_HARNESS_PANEL_SOURCE,
      REGISTERED_SKILLS_PANEL_SOURCE,
    ]) {
      const source = readRepoFile(path);
      expect(source, path).not.toContain("exportAgentRuntimeEvidencePack");
      expect(source, path).not.toContain("evidence/export");
    }
  });

  it("删除后的 renderer Evidence Pack facade 不得回流", () => {
    for (const path of [
      EXPORT_CLIENT_SOURCE,
      "src/lib/api/agentRuntime/exportClient.d.ts",
      "src/lib/api/agentRuntime/normalizers.ts",
      "src/lib/api/agentRuntime/normalizers.d.ts",
    ]) {
      const source = readRepoFile(path);
      expect(source, path).not.toContain("exportAgentRuntimeEvidencePack");
      expect(source, path).not.toContain("AgentRuntimeEvidencePack");
      expect(source, path).not.toContain("normalizeEvidencePack");
      expect(source, path).not.toContain(
        "projectAppServerEvidenceExportToRuntimeEvidencePack",
      );
    }
  });

  it("派生导出必须校验返回制品仍属于请求 session", () => {
    const source = readRepoFile(EXPORT_CLIENT_SOURCE);

    expect(source).toContain("function assertRuntimeExportSessionCorrelation");
    expect(
      countOccurrences(source, "assertRuntimeExportSessionCorrelation("),
    ).toBe(6);

    for (const [functionName, methodName] of [
      [
        "exportAgentRuntimeHandoffBundle",
        "APP_SERVER_METHOD_AGENT_SESSION_HANDOFF_BUNDLE_EXPORT",
      ],
      [
        "exportAgentRuntimeAnalysisHandoff",
        "APP_SERVER_METHOD_AGENT_SESSION_ANALYSIS_HANDOFF_EXPORT",
      ],
      [
        "exportAgentRuntimeReviewDecisionTemplate",
        "APP_SERVER_METHOD_AGENT_SESSION_REVIEW_DECISION_TEMPLATE_EXPORT",
      ],
      [
        "saveAgentRuntimeReviewDecision",
        "APP_SERVER_METHOD_AGENT_SESSION_REVIEW_DECISION_SAVE",
      ],
      [
        "exportAgentRuntimeReplayCase",
        "APP_SERVER_METHOD_AGENT_SESSION_REPLAY_CASE_EXPORT",
      ],
    ] as const) {
      const functionBody = extractFunctionBody(source, functionName);

      expect(functionBody, `${functionName} 不存在`).not.toBe("");
      assertInOrder(functionBody, [
        "assertRuntimeExportResult(",
        "assertRuntimeExportSessionCorrelation(",
        methodName,
        "normalizedSessionId",
      ]);
    }
  });

  it("生产源码不得重新调用 agent_runtime_export_* legacy command", async () => {
    const files = PRODUCTION_SCAN_ROOTS.flatMap((root) =>
      collectSourceFiles(join(REPO_ROOT, root)),
    ).filter((file) => isProductionSource(repoRelative(file)));
    const offenders: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = repoRelative(file);
      const source = readFileSync(file, "utf8");
      const matches = [...source.matchAll(/agent_runtime_export_[a-z0-9_]+/gu)];
      offenders.push(...matches.map((match) => `${path}: ${match[0]}`));
      // 小文件避免线程池往返；分批让出事件循环，原测试期限仍可执行。
      if ((index + 1) % 64 === 0) await yieldIO();
    }

    expect(
      offenders.sort(),
      "agent_runtime_export_* 只能作为测试 / retired guard / 诊断夹具出现；生产 evidence / replay / handoff 导出必须走 App Server current methods",
    ).toEqual([]);
  });

  it("终端只由外层标签与current command/exec持有，旧嵌套工具栏不得回流", () => {
    const componentRoot = "src/components/agent/chat/components";
    for (const name of [
      "ProjectShellSurface",
      "ProjectShellTerminal",
      "TaskCenterShellPanel",
      "ShellBackgroundTerminalList",
    ]) {
      expect(existsSync(join(REPO_ROOT, componentRoot, `${name}.tsx`))).toBe(
        false,
      );
    }
    const panel = readRepoFile(`${componentRoot}/TerminalPanel.tsx`);
    expect(panel).toContain("@/lib/api/commandExec");
    expect(panel).not.toMatch(/bg-white|PROJECT_SHELL_THEME|runQuickCommand/);
    const host = readRepoFile(
      "src/components/agent/chat/workspace/WorkspaceRightSurfaceHostRuntime.tsx",
    );
    expect(host).toContain("<TerminalTab");
    const canvas = readRepoFile(
      `${componentRoot}/canvas-workbench/CanvasWorkbenchShell.tsx`,
    );
    expect(canvas).not.toMatch(/\bTerminalTab\b|\bTerminalPanel\b/);
    for (const name of [
      "tabs/useCanvasWorkbenchToolTabsState.ts",
      "tabs/CanvasWorkbenchToolTabsViewModel.ts",
      "files/CanvasWorkbenchProjectFilesPanel.tsx",
      "files/useCanvasWorkbenchProjectFilesSplitState.ts",
      "CanvasWorkbenchWorkspacePanel.tsx",
    ]) {
      expect(
        existsSync(join(REPO_ROOT, componentRoot, "canvas-workbench", name)),
        `${name} 不得恢复重复的目录或终端 owner`,
      ).toBe(false);
    }
    for (const source of [host, canvas]) {
      expect(source).not.toMatch(
        /ProjectShellSurface|TaskCenterShellPanel|ShellBackgroundTerminalList/,
      );
    }
  });
  it("批注重开不得恢复已删除的 Canvas 入口或导出", () => {
    const workspace = "src/components/agent/chat/workspace";
    for (const name of [
      "useWorkspaceArtifactOpenRuntime.tsx",
      "useAgentChatWorkspaceCommandRuntime.ts",
      "useAgentChatWorkspaceSceneRuntime.tsx",
    ]) {
      expect(readRepoFile(`${workspace}/${name}`)).not.toContain(
        "openProjectFilePreviewInCanvas",
      );
    }
  });
  it("文件树与路径菜单共享目录owner，已删除的产物隐藏策略不得回流", () => {
    const workspace = "src/components/agent/chat/workspace";
    expect(
      existsSync(join(REPO_ROOT, workspace, "workspaceTreeVisibility.ts")),
    ).toBe(false);
    const treeOwner = readRepoFile(
      "src/components/agent/chat/workspace/right-surface/useFileTreeState.ts",
    );
    expect(treeOwner).not.toMatch(
      /filterWorkspaceDirectoryListing|shouldHideWorkspaceTreeEntry|ROOT_HIDDEN_/,
    );
    for (const file of [
      "right-surface/WorkspaceFileTree.tsx",
      "text-file-editor/FileSourceBreadcrumb.tsx",
    ]) {
      const source = readRepoFile(`${workspace}/${file}`);
      expect(source).toContain("WorkspaceDirectoryTree");
      expect(source).not.toMatch(
        /listDirectory\(|readDirectory\(|safeInvoke\(/,
      );
    }
  });
  it("项目文件动作共用文件壳，已删除的四选一工具Host不得回流", () => {
    expect(existsSync(join(REPO_ROOT, "electron/projectToolsHost.ts"))).toBe(
      false,
    );
    expect(readRepoFile("src/lib/api/fileSystem.ts")).not.toMatch(
      /ProjectPathOpenTool|openProjectPathWithTool|open_project_path_with_tool/,
    );
    expect(
      readRepoFile("src/lib/governance/agentCommandCatalog.json"),
    ).not.toContain("open_project_path_with_tool");
  });
});
