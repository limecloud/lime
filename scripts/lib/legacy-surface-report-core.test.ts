// @vitest-environment node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { toSerializableLegacySurfaceReport } from "./legacy-surface-report-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const reporterPath = fileURLToPath(
  new URL("../report-legacy-surfaces.mjs", import.meta.url),
);
const composerMonitorId = "retired-primary-composer-textarea-adapter";

function scanFixture(
  files: Record<string, string>,
  monitorId = composerMonitorId,
) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lime-composer-legacy-guard-")),
  );
  try {
    const outputPath = path.join(directory, "report.json");
    for (const [relativePath, source] of Object.entries(files)) {
      const destination = path.join(directory, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source);
    }
    const result = spawnSync(
      process.execPath,
      [reporterPath, "--json", "--output", outputPath],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const monitor = report.frontendTextResults.find(
      (entry: { id: string }) => entry.id === monitorId,
    );
    expect(monitor).toBeDefined();
    return { status: result.status, monitor, report };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("legacy-surface-report-core", () => {
  it.each([
    "export { FilePreviewMode as CanvasWorkbenchPreviewMode } from './filePreviewModel';",
    "export { useFileTreeState as useCanvasWorkbenchFileTreeState } from './right-surface/useFileTreeState';",
    "export const panel = 'canvas-workbench-preview-mode-panel';",
  ])("真实 report 拒绝旧 Canvas 文件合同回流：%s", (source) => {
    const owner = "src/components/agent/chat/workspace/Preview.tsx";
    const result = scanFixture(
      { [owner]: source },
      "retired-canvas-file-model-contract",
    );
    expect(result.monitor.violations).toEqual([owner]);
    expect(result.status).toBe(1);
  });

  it("真实 report 拒绝 Files 重新消费 Canvas selection 投影", () => {
    const owner = "src/components/agent/chat/workspace/FilePreviewPanel.tsx";
    const result = scanFixture(
      {
        [owner]:
          "import type { CanvasWorkbenchResolvedSelection } from '../components/CanvasWorkbenchLayoutViewModel';",
      },
      "files-preview-no-canvas-projection",
    );
    expect(result.monitor.violations).toEqual([owner]);
    expect(result.status).toBe(1);
  });

  it("Files 守卫允许唯一文件预览与目录 owner", () => {
    const source =
      "import type { FilePreviewContext } from './filePreviewTarget'; import { useFileTreeState } from './right-surface/useFileTreeState';";
    for (const monitor of [
      "retired-canvas-file-model-contract",
      "files-preview-no-canvas-projection",
    ]) {
      const result = scanFixture(
        { "src/components/agent/chat/workspace/FilePreviewPanel.tsx": source },
        monitor,
      );
      expect(result.monitor.violations).toEqual([]);
      expect(result.status).toBe(0);
    }
  });

  it("真实 report 拒绝恢复旧 Canvas 文件预览组件或包装", () => {
    const owner = "src/components/agent/chat/workspace/Preview.tsx";
    const result = scanFixture(
      {
        [owner]:
          "export { FilePreviewPanel as CanvasWorkbenchPreviewModePanel } from './FilePreviewPanel';",
      },
      "retired-canvas-file-preview-panel",
    );
    expect(result.monitor.violations).toEqual([owner]);
    expect(result.status).toBe(1);
  });

  it("文件预览守卫允许 current 面板与单一保存 owner", () => {
    const result = scanFixture(
      {
        "src/components/agent/chat/workspace/FilePreviewTabContent.tsx":
          "import { FilePreviewPanel } from './FilePreviewPanel'; export const download = useWorkspaceFileActions(tab, path, isCurrent).saveAs;",
      },
      "retired-canvas-file-preview-panel",
    );
    expect(result.monitor.violations).toEqual([]);
    expect(result.status).toBe(0);
  });

  it.each([
    "import { CodingWorkbenchRecoveryPanel } from './CodingWorkbenchRecoveryPanel';",
    "export const submit = { onSubmitRecoveryPrompt: send };",
    "export const metadata = { harness: { coding_workbench_recovery: context } };",
  ])("真实 report 应拒绝恢复专用 Workbench Recovery 合同：%s", (source) => {
    const owner =
      "src/components/agent/chat/workspace/workspaceConversationCodingViews.tsx";
    const result = scanFixture(
      { [owner]: source },
      "retired-workbench-recovery-contract",
    );

    expect(result.monitor.violations).toEqual([owner]);
    expect(result.status).toBe(1);
  });

  it("Recovery 清退守卫允许 canonical 失败恢复和 checkpoint owner", () => {
    const result = scanFixture(
      {
        "src/components/agent/chat/hooks/agentSilentTurnRecovery.ts":
          "export const recover = { threadId, turnId, status: 'failed' };",
        "src/components/agent/chat/workspace/workspaceConversationCodingViews.tsx":
          "export const changeView = { fileCheckpointSummary, onOpenFile };",
      },
      "retired-workbench-recovery-contract",
    );

    expect(result.monitor.violations).toEqual([]);
    expect(result.status).toBe(0);
  });

  it.each([
    "export const views = { logView: renderPanel };",
    "export const panel = <CanvasWorkbenchLayout logView={view} />;",
    "import { CodingWorkbenchLogPanel } from './CodingWorkbenchLogPanel';",
  ])("真实 report 应拒绝恢复旧 Workbench 日志接线：%s", (source) => {
    const owner =
      "src/components/agent/chat/workspace/workspaceConversationCodingViews.tsx";
    const result = scanFixture(
      { [owner]: source },
      "retired-workbench-log-projection",
    );

    expect(result.monitor.violations).toEqual([owner]);
    expect(result.status).toBe(1);
  });

  it("日志清退守卫允许正常 dialogView 与独立设置日志", () => {
    const result = scanFixture(
      {
        "src/components/agent/chat/workspace/ConfirmDialog.tsx":
          "export const dialogView = <Dialog />;",
        "src/components/settings-v2/system/channels/ChannelLogs.tsx":
          "export const logView = <ChannelLogs />;",
      },
      "retired-workbench-log-projection",
    );

    expect(result.monitor.violations).toEqual([]);
    expect(result.status).toBe(0);
  });

  it.each([
    {
      owner: "src/components/input-kit/ComposerEditor.tsx",
      source:
        'export function ComposerEditor() { return <textarea aria-label="Message" />; }',
    },
    {
      owner: "src/components/input-kit/ComposerController.ts",
      source:
        "export function readDraft(textareaRef: { current: HTMLTextAreaElement }) { return textareaRef.current.value; }",
    },
    {
      owner: "src/components/input-kit/adapters/agentAdapter.ts",
      source:
        "export function applyInputbarPluginSelection(text: string, selection: { label: string }) { return text + selection.label; }",
    },
    {
      owner: "src/components/agent/chat/components/EmptyState.tsx",
      source:
        'export function EmptyState() { return <textarea aria-label="New conversation" />; }',
    },
  ])("$owner 恢复旧主输入适配器时真实 report 必须拒绝", ({ owner, source }) => {
    const result = scanFixture({ [owner]: source });

    expect(result.monitor.references).toEqual([owner]);
    expect(result.monitor.violations).toEqual([owner]);
    expect(result.report.summary.violations).toContain(
      `${composerMonitorId} -> ${owner}`,
    );
    expect(result.status).toBe(1);
  });

  it("真实 current Composer 和 Home 源码通过主输入回流守卫", () => {
    const owners = [
      "src/components/input-kit/BaseComposer.tsx",
      "src/components/input-kit/ComposerEditor.tsx",
      "src/components/input-kit/ComposerController.ts",
      "src/components/agent/chat/components/EmptyState.tsx",
    ];
    const result = scanFixture(
      Object.fromEntries(
        owners.map((owner) => [
          owner,
          fs.readFileSync(path.join(repositoryRoot, owner), "utf8"),
        ]),
      ),
    );

    expect(result.monitor.references).toEqual([]);
    expect(result.monitor.violations).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("普通资料表单、通用 UI 和 TUI textarea 不属于退役主输入适配器", () => {
    const owners = [
      "src/components/settings-v2/account/profile/index.tsx",
      "src/components/ui/textarea.tsx",
      "lime-rs/crates/tui/src/bottom_pane/chat_composer.rs",
    ];
    const result = scanFixture(
      Object.fromEntries(
        owners.map((owner) => [
          owner,
          fs.readFileSync(path.join(repositoryRoot, owner), "utf8"),
        ]),
      ),
    );

    expect(result.monitor.references).toEqual([]);
    expect(result.monitor.violations).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("应把命令引用 Map 序列化成普通对象", () => {
    const serialized = toSerializableLegacySurfaceReport({
      repoRoot: "/tmp/lime",
      runtimeSources: [{ relativePath: "src/foo.ts" }],
      testSources: [{ relativePath: "src/foo.test.ts" }],
      rustRuntimeSources: [
        { relativePath: "lime-rs/crates/app-server/src/lib.rs" },
      ],
      rustTestSources: [],
      importResults: [],
      commandResults: [
        {
          id: "agent-runtime",
          classification: "current",
          description: "runtime command",
          commands: ["agent_runtime_submit_turn"],
          allowedPaths: ["src/lib/api/agentRuntime.ts"],
          referencesByCommand: new Map([
            ["agent_runtime_submit_turn", ["src/lib/api/agentRuntime.ts"]],
          ]),
          testReferencesByCommand: new Map([
            ["agent_runtime_submit_turn", ["src/lib/api/agentRuntime.test.ts"]],
          ]),
          violations: [],
        },
      ],
      frontendTextResults: [],
      rustTextResults: [],
      rustTextCountResults: [],
      zeroReferenceCandidates: [],
      classificationDriftCandidates: [],
      violations: [],
    });

    expect(serialized.summary.runtimeSourceCount).toBe(1);
    expect(serialized.commandResults[0].referencesByCommand).toEqual({
      agent_runtime_submit_turn: ["src/lib/api/agentRuntime.ts"],
    });
    expect(serialized.commandResults[0].testReferencesByCommand).toEqual({
      agent_runtime_submit_turn: ["src/lib/api/agentRuntime.test.ts"],
    });
  });
});
