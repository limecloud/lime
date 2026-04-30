import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWorkbenchShell } from "./ArtifactWorkbenchShell";
import {
  ArtifactWorkbenchDocumentInspector,
  useArtifactWorkbenchDocumentController,
} from "./artifactWorkbenchDocument";
import {
  areLightweightRenderersRegistered,
  registerLightweightRenderers,
} from "@/components/artifact/renderers";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import type { AgentThreadItem } from "../types";

vi.mock("@/lib/workspace/workbenchCanvas", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace/workbenchCanvas")>();
  const ReactModule = await import("react");

  const MockNotionEditor = ReactModule.forwardRef<
    { flushContent: () => string },
    {
      content: string;
      onCommit: (content: string) => void;
      onSave: (latestContent?: string) => void;
      onCancel: () => void;
    }
  >(({ content, onCommit, onSave, onCancel }, ref) => {
    const [value, setValue] = ReactModule.useState(content);

    ReactModule.useEffect(() => {
      setValue(content);
    }, [content]);

    ReactModule.useImperativeHandle(
      ref,
      () => ({
        flushContent: () => value,
      }),
      [value],
    );

    return (
      <div data-testid="mock-notion-editor">
        <textarea
          data-testid="mock-notion-editor-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onCommit(event.target.value);
          }}
        />
        <button type="button" onClick={() => onSave(value)}>
          保存编辑器
        </button>
        <button type="button" onClick={onCancel}>
          取消编辑器
        </button>
      </div>
    );
  });

  MockNotionEditor.displayName = "MockNotionEditor";

  return {
    ...actual,
    NotionEditor: MockNotionEditor,
  };
});

interface MountedShell {
  container: HTMLDivElement;
  root: Root;
}

const mountedShells: MountedShell[] = [];

interface ArtifactWorkbenchHarnessOverrides extends Partial<
  Omit<
    React.ComponentProps<typeof ArtifactWorkbenchShell>,
    "documentController"
  >
> {
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
}

function createArtifactDocumentArtifact(
  options: {
    status?: "ready" | "draft" | "failed" | "archived";
    currentVersionStatus?: "ready" | "draft" | "failed" | "archived";
    meta?: Record<string, unknown>;
  } = {},
): Artifact {
  const status = options.status || "ready";
  const currentVersionStatus = options.currentVersionStatus || status;
  const content = JSON.stringify({
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:demo",
    kind: "analysis",
    title: "董事会季度复盘",
    status,
    language: "zh-CN",
    summary: "需要优先补齐来源与版本线索。",
    blocks: [
      {
        id: "hero-1",
        type: "hero_summary",
        summary: "核心摘要",
        sourceIds: ["source-1"],
      },
      {
        id: "body-1",
        type: "rich_text",
        contentFormat: "markdown",
        content: "正文内容",
        markdown: "正文内容",
        sourceIds: ["source-1"],
      },
    ],
    sources: [
      {
        id: "source-1",
        type: "web",
        label: "OpenAI Blog",
        locator: {
          url: "https://openai.com",
        },
      },
    ],
    metadata: {
      currentVersionId: "artifact-document:demo:v2",
      currentVersionNo: 2,
      currentVersionDiff: {
        baseVersionId: "artifact-document:demo:v1",
        baseVersionNo: 1,
        targetVersionId: "artifact-document:demo:v2",
        targetVersionNo: 2,
        updatedCount: 1,
        changedBlocks: [
          {
            blockId: "body-1",
            changeType: "updated",
            beforeText: "旧正文",
            afterText: "正文内容",
            summary: "更新 block 内容",
          },
        ],
      },
      versionHistory: [
        {
          id: "artifact-document:demo:v1",
          artifactId: "artifact-document:demo",
          versionNo: 1,
          title: "董事会季度复盘",
          summary: "第一版摘要",
          status: "ready",
        },
        {
          id: "artifact-document:demo:v2",
          artifactId: "artifact-document:demo",
          versionNo: 2,
          title: "董事会季度复盘",
          summary: "补齐来源与版本信息",
          status: currentVersionStatus,
        },
      ],
    },
  });

  return {
    id: "artifact-1",
    type: "document",
    title: "board-review.artifact.json",
    content,
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/board-review.artifact.json",
      filename: "board-review.artifact.json",
      language: "json",
      ...options.meta,
    },
    position: { start: 0, end: content.length },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createStructuredEditableArtifact(): Artifact {
  const content = JSON.stringify({
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:editable",
    kind: "report",
    title: "结构化编辑演示",
    status: "ready",
    language: "zh-CN",
    summary: "用于验证章节头、摘要卡与提示块编辑。",
    blocks: [
      {
        id: "section-1",
        type: "section_header",
        title: "执行摘要",
        description: "先看结论，再看展开分析。",
      },
      {
        id: "hero-structured",
        type: "hero_summary",
        eyebrow: "董事会视角",
        title: "季度经营摘要",
        summary: "收入增长稳定，但需要关注交付效率。",
        highlights: ["收入增长 18%", "交付时延仍偏高"],
      },
      {
        id: "body-structured",
        type: "rich_text",
        contentFormat: "markdown",
        content: "这里是详细分析。",
        markdown: "这里是详细分析。",
      },
      {
        id: "callout-1",
        type: "callout",
        title: "风险提示",
        body: "第二季度需重点压缩项目交付周期。",
        content: "第二季度需重点压缩项目交付周期。",
        tone: "warning",
      },
    ],
    sources: [],
    metadata: {},
  });

  return {
    id: "artifact-structured",
    type: "document",
    title: "structured-edit.artifact.json",
    content,
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/structured-edit.artifact.json",
      filename: "structured-edit.artifact.json",
      language: "json",
    },
    position: { start: 0, end: content.length },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createTranscriptionDocumentArtifact(): Artifact {
  const content = JSON.stringify({
    schemaVersion: "artifact_document.v1",
    artifactId: "transcription-generate:task-transcription-1",
    kind: "brief",
    title: "内容转写任务",
    status: "ready",
    language: "zh-CN",
    summary: "用于验证 transcript 校对稿保存。",
    blocks: [
      {
        id: "transcript-segments",
        type: "table",
        title: "转写时间轴（可逐段编辑校对）",
        columns: ["时间", "说话人", "内容"],
        rows: [["00:01 - 00:03", "主持人", "欢迎来到 Lime 访谈节目。"]],
      },
      {
        id: "transcript-text",
        type: "code_block",
        title: "转写文本（可编辑校对）",
        language: "text",
        code: "欢迎来到 Lime 访谈节目。",
      },
    ],
    sources: [
      {
        id: "transcript-file",
        type: "file",
        label: "transcript output",
        locator: {
          path: ".lime/runtime/transcripts/task-transcription-1.txt",
        },
        reliability: "primary",
      },
    ],
    metadata: {
      taskId: "task-transcription-1",
      taskType: "transcription_generate",
      modalityContractKey: "audio_transcription",
      transcriptPath: ".lime/runtime/transcripts/task-transcription-1.txt",
      transcriptText: "欢迎来到 Lime 访谈节目。",
      transcriptSegments: [
        {
          id: "segment-1",
          index: 1,
          startMs: 1000,
          endMs: 3000,
          speaker: "主持人",
          text: "欢迎来到 Lime 访谈节目。",
        },
      ],
      transcriptCorrectionEnabled: true,
      transcriptCorrectionStatus: "available",
      transcriptCorrectionSource: "artifact_document_version",
    },
  });

  return {
    id: "artifact-transcription",
    type: "document",
    title: "task-transcription-1.artifact.json",
    content,
    status: "complete",
    meta: {
      filePath:
        ".lime/runtime/transcription-generate/task-transcription-1.artifact.json",
      filename: "task-transcription-1.artifact.json",
      language: "json",
    },
    position: { start: 0, end: content.length },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createAdvancedEditableArtifact(): Artifact {
  const content = JSON.stringify({
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:advanced-editable",
    kind: "analysis",
    title: "更多结构化块编辑演示",
    status: "ready",
    language: "zh-CN",
    summary: "用于验证更多结构化 block 的编辑回写。",
    blocks: [
      {
        id: "section-advanced",
        type: "section_header",
        title: "重点跟进",
        description: "围绕经营动作做块级编辑。",
      },
      {
        id: "keypoints-1",
        type: "key_points",
        title: "关键结论",
        items: ["收入保持增长", "交付效率需要治理"],
      },
      {
        id: "table-1",
        type: "table",
        title: "经营对比表",
        columns: ["维度", "现状", "动作"],
        rows: [
          ["收入", "稳定", "继续追踪"],
          ["交付", "偏慢", "压缩周期"],
        ],
      },
      {
        id: "checklist-1",
        type: "checklist",
        title: "推进清单",
        items: [
          { id: "task-1", text: "梳理重点客户", state: "todo" },
          { id: "task-2", text: "压缩交付周期", state: "doing" },
        ],
      },
      {
        id: "metric-1",
        type: "metric_grid",
        title: "经营指标",
        metrics: [
          {
            id: "metric-1-a",
            label: "ARR",
            value: "18%",
            note: "同比增长",
            tone: "success",
          },
          {
            id: "metric-1-b",
            label: "交付时延",
            value: "12 天",
            note: "仍高于目标",
            tone: "warning",
          },
        ],
      },
      {
        id: "quote-1",
        type: "quote",
        text: "交付效率会直接影响下季度毛利。",
        attribution: "COO 周会",
      },
      {
        id: "code-1",
        type: "code_block",
        title: "执行脚本",
        language: "bash",
        code: "npm run verify:local",
      },
    ],
    sources: [],
    metadata: {},
  });

  return {
    id: "artifact-advanced-structured",
    type: "document",
    title: "advanced-structured-edit.artifact.json",
    content,
    status: "complete",
    meta: {
      filePath:
        ".lime/artifacts/thread-1/advanced-structured-edit.artifact.json",
      filename: "advanced-structured-edit.artifact.json",
      language: "json",
    },
    position: { start: 0, end: content.length },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createArtifactTimelineItems(): AgentThreadItem[] {
  return [
    {
      id: "thread-item-body",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 4,
      status: "completed",
      started_at: "2026-03-25T10:00:00Z",
      completed_at: "2026-03-25T10:00:01Z",
      updated_at: "2026-03-25T10:00:01Z",
      type: "file_artifact",
      path: ".lime/artifacts/thread-1/board-review.artifact.json",
      source: "artifact_snapshot",
      content: createArtifactDocumentArtifact().content,
      metadata: {
        artifact_id: "artifact-document:demo",
        artifact_block_id: "body-1",
      },
    },
  ];
}

function renderShell(
  artifact: Artifact,
  overrides: ArtifactWorkbenchHarnessOverrides = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const {
    onSaveArtifactDocument,
    threadItems,
    focusedBlockId,
    blockFocusRequestKey,
    onJumpToTimelineItem,
    ...shellOverrides
  } = overrides;

  function ShellHarness() {
    const controller = useArtifactWorkbenchDocumentController({
      artifact,
      onSaveArtifactDocument,
      threadItems,
      focusedBlockId,
      blockFocusRequestKey,
      onJumpToTimelineItem,
    });

    return (
      <ArtifactWorkbenchShell
        artifact={artifact}
        artifactOverlay={null}
        isStreaming={false}
        showPreviousVersionBadge={false}
        viewMode="preview"
        onViewModeChange={() => {}}
        previewSize="desktop"
        onPreviewSizeChange={() => {}}
        onCloseCanvas={() => {}}
        {...shellOverrides}
        documentController={controller}
      />
    );
  }

  act(() => {
    root.render(<ShellHarness />);
  });

  mountedShells.push({ container, root });
  return container;
}

function renderWorkbench(
  artifact: Artifact,
  overrides: ArtifactWorkbenchHarnessOverrides = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const {
    onSaveArtifactDocument,
    threadItems,
    focusedBlockId,
    blockFocusRequestKey,
    onJumpToTimelineItem,
    ...shellOverrides
  } = overrides;

  function WorkbenchHarness() {
    const controller = useArtifactWorkbenchDocumentController({
      artifact,
      onSaveArtifactDocument,
      threadItems,
      focusedBlockId,
      blockFocusRequestKey,
      onJumpToTimelineItem,
    });

    return (
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px]">
        <ArtifactWorkbenchShell
          artifact={artifact}
          artifactOverlay={null}
          isStreaming={false}
          showPreviousVersionBadge={false}
          viewMode="preview"
          onViewModeChange={() => {}}
          previewSize="desktop"
          onPreviewSizeChange={() => {}}
          onCloseCanvas={() => {}}
          {...shellOverrides}
          documentController={controller}
        />
        <ArtifactWorkbenchDocumentInspector
          controller={controller}
          testId="artifact-workbench-document-inspector"
          containerClassName="min-h-0 border-l border-slate-200 bg-slate-50/70"
          tabsClassName="flex h-full min-h-0 flex-col p-4"
        />
      </div>
    );
  }

  act(() => {
    root.render(<WorkbenchHarness />);
  });

  mountedShells.push({ container, root });
  return container;
}

function setTextControlValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();

  if (!areLightweightRenderersRegistered()) {
    registerLightweightRenderers();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  while (mountedShells.length > 0) {
    const mounted = mountedShells.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("ArtifactWorkbenchShell", () => {
  it("运行态 shell 默认只保留正文画布，不再直接渲染 inspector 侧栏", async () => {
    const container = renderShell(createArtifactDocumentArtifact());

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="artifact-workbench-shell"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="artifact-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("canvas-only");
    const buttons = Array.from(container.querySelectorAll("button"));
    const tabLabels = ["概览", "来源", "版本", "差异", "编辑"];
    for (const label of tabLabels) {
      expect(
        buttons.find((button) => button.textContent?.includes(label)),
      ).toBeUndefined();
    }
  });

  it("文稿工作台集成 harness 应展示概览、来源、版本 inspector", async () => {
    const container = renderWorkbench(createArtifactDocumentArtifact());

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("概览");
    expect(container.textContent).toContain("来源");
    expect(container.textContent).toContain("版本");
    expect(container.textContent).toContain("差异");
    expect(container.textContent).toContain("更新 block 内容");

    const sourcesTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("来源"));
    expect(sourcesTrigger).not.toBeUndefined();

    await act(async () => {
      sourcesTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("OpenAI Blog");
    expect(container.textContent).toContain("block hero-1");
  });

  it("恢复为草稿时应展示低压状态说明", async () => {
    const container = renderWorkbench(
      createArtifactDocumentArtifact({
        status: "draft",
        currentVersionStatus: "draft",
        meta: {
          artifactFallbackUsed: true,
          artifactValidationRepaired: true,
          artifactValidationIssues: [
            "模型未返回合法的 ArtifactDocument JSON，已按 Markdown 正文自动恢复为可渲染文档。",
          ],
        },
      }),
      {
        onSaveArtifactDocument: vi.fn().mockResolvedValue(undefined),
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const overviewTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("概览"));
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已整理为可继续编辑的草稿");
    expect(container.textContent).toContain(
      "系统已先把可用正文整理成恢复稿。你可以直接继续编辑，确认内容顺畅后，再手动标记为可阅读。",
    );
    expect(container.textContent).toContain("恢复稿");
    expect(
      container.querySelector(
        '[data-testid="artifact-recovery-continue-editing"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-recovery-mark-ready"]'),
    ).not.toBeNull();
  });

  it("恢复稿可从概览直接切到编辑态", async () => {
    const container = renderWorkbench(
      createArtifactDocumentArtifact({
        status: "draft",
        currentVersionStatus: "draft",
        meta: {
          artifactFallbackUsed: true,
          artifactValidationIssues: [
            "模型未返回合法的 ArtifactDocument JSON，已按 Markdown 正文自动恢复为可渲染文档。",
          ],
        },
      }),
      {
        onSaveArtifactDocument: vi.fn().mockResolvedValue(undefined),
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const overviewTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("概览"));
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const continueEditingButton = container.querySelector(
      '[data-testid="artifact-recovery-continue-editing"]',
    ) as HTMLButtonElement | null;
    expect(continueEditingButton).not.toBeNull();

    await act(async () => {
      continueEditingButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("正文块 1");
  });

  it("恢复稿应支持标记为可阅读并沿保存链回写 ready 状态", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(
      createArtifactDocumentArtifact({
        status: "draft",
        currentVersionStatus: "draft",
        meta: {
          artifactFallbackUsed: true,
          artifactValidationIssues: [
            "模型未返回合法的 ArtifactDocument JSON，已按 Markdown 正文自动恢复为可渲染文档。",
          ],
        },
      }),
      {
        onSaveArtifactDocument: handleSaveArtifactDocument,
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const overviewTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("概览"));
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const markReadyButton = container.querySelector(
      '[data-testid="artifact-recovery-mark-ready"]',
    ) as HTMLButtonElement | null;
    expect(markReadyButton).not.toBeNull();

    await act(async () => {
      markReadyButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-1" }),
      expect.objectContaining({
        status: "ready",
        metadata: expect.objectContaining({
          versionHistory: expect.arrayContaining([
            expect.objectContaining({
              id: "artifact-document:demo:v2",
              status: "ready",
            }),
          ]),
        }),
      }),
    );
  });

  it("应支持从来源项与差异项跳转到对应 block", async () => {
    const container = renderWorkbench(createArtifactDocumentArtifact());

    await act(async () => {
      await Promise.resolve();
    });

    const sourcesTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("来源"));
    expect(sourcesTrigger).not.toBeUndefined();

    await act(async () => {
      sourcesTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const sourceButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("OpenAI Blog"),
    );
    expect(sourceButton).not.toBeUndefined();

    await act(async () => {
      sourceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const heroBlock = container.querySelector("#artifact-block-hero-1");
    expect(heroBlock?.classList.contains("ring-2")).toBe(true);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    const diffTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("差异"),
    );
    expect(diffTrigger).not.toBeUndefined();

    await act(async () => {
      diffTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const diffJumpButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("跳到 block"));
    expect(diffJumpButton).not.toBeUndefined();

    await act(async () => {
      diffJumpButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyBlock = container.querySelector("#artifact-block-body-1");
    expect(bodyBlock?.classList.contains("ring-2")).toBe(true);
  });

  it("提供保存回调时应展示编辑页签，并把更新后的文档回传主链", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createArtifactDocumentArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyBlockTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("正文块 1"));
    expect(bodyBlockTrigger).not.toBeUndefined();

    await act(async () => {
      bodyBlockTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const editorInput = container.querySelector(
      '[data-testid="mock-notion-editor-input"]',
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();

    await act(async () => {
      if (editorInput) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(editorInput, "更新后的正文");
        editorInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存编辑器"),
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-1" }),
      expect.objectContaining({
        schemaVersion: "artifact_document.v1",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "body-1",
            type: "rich_text",
            contentFormat: "markdown",
            content: "更新后的正文",
            markdown: "更新后的正文",
          }),
        ]),
        metadata: expect.objectContaining({
          currentVersionId: "artifact-document:demo:v3",
          currentVersionNo: 3,
          currentVersionDiff: expect.objectContaining({
            baseVersionId: "artifact-document:demo:v2",
            baseVersionNo: 2,
            targetVersionId: "artifact-document:demo:v3",
            targetVersionNo: 3,
            updatedCount: 1,
            changedBlocks: expect.arrayContaining([
              expect.objectContaining({
                blockId: "body-1",
                changeType: "updated",
                beforeText: "正文内容",
                afterText: "更新后的正文",
              }),
            ]),
          }),
          versionHistory: expect.arrayContaining([
            expect.objectContaining({
              id: "artifact-document:demo:v3",
              versionNo: 3,
              summary: "更新 正文块 1",
              createdBy: "user",
            }),
          ]),
        }),
      }),
    );
  });

  it("已归档文档不应继续展示编辑页签", async () => {
    const container = renderWorkbench(
      createArtifactDocumentArtifact({
        status: "archived",
        currentVersionStatus: "archived",
      }),
      {
        onSaveArtifactDocument: vi.fn().mockResolvedValue(undefined),
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).toBeUndefined();

    const overviewTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("概览"));
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已归档");
  });

  it("应支持在 workbench 中编辑结构化摘要块并回写 highlights", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createStructuredEditableArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const heroTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("季度经营摘要"),
    );
    expect(heroTrigger).not.toBeUndefined();

    await act(async () => {
      heroTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const summaryInput = container.querySelector(
      '[data-testid="artifact-structured-edit-summary"]',
    ) as HTMLTextAreaElement | null;
    const highlightsInput = container.querySelector(
      '[data-testid="artifact-structured-edit-highlights"]',
    ) as HTMLTextAreaElement | null;

    expect(summaryInput).not.toBeNull();
    expect(highlightsInput).not.toBeNull();

    await act(async () => {
      if (summaryInput) {
        setTextControlValue(summaryInput, "更新后的摘要正文");
      }
      if (highlightsInput) {
        setTextControlValue(highlightsInput, "保留现金流优势\n压缩交付周期");
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "hero-structured",
            type: "hero_summary",
            summary: "更新后的摘要正文",
            highlights: ["保留现金流优势", "压缩交付周期"],
          }),
        ]),
      }),
    );
  });

  it("转写运行时文档保存时应记录校对稿 metadata", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createTranscriptionDocumentArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const transcriptTextTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("转写文本"));
    expect(transcriptTextTrigger).not.toBeUndefined();

    await act(async () => {
      transcriptTextTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const codeInput = container.querySelector(
      '[data-testid="artifact-structured-edit-code"]',
    ) as HTMLTextAreaElement | null;
    expect(codeInput).not.toBeNull();

    await act(async () => {
      if (codeInput) {
        setTextControlValue(
          codeInput,
          "欢迎来到 Lime 访谈节目。\n这里是人工校对后的补充。",
        );
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-transcription" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "transcript-text",
            type: "code_block",
            code: "欢迎来到 Lime 访谈节目。\n这里是人工校对后的补充。",
          }),
          expect.objectContaining({
            id: "transcript-correction-status",
            type: "callout",
            tone: "success",
            title: "校对稿已保存",
            body: expect.stringContaining("原始 ASR 输出文件保持不变"),
          }),
        ]),
        metadata: expect.objectContaining({
          modalityContractKey: "audio_transcription",
          transcriptCorrectionStatus: "saved",
          transcriptCorrectionSource: "artifact_document_version",
          transcriptCorrectionPatchKind: "artifact_document_version",
          transcriptCorrectionOriginalImmutable: true,
          transcriptCorrectionEditedBlockId: "transcript-text",
          transcriptCorrectionTextBlockId: "transcript-text",
          transcriptCorrectionSegmentBlockId: "transcript-segments",
          transcriptCorrectionSegmentCount: 1,
          transcriptCorrectionSpeakerCount: 1,
          transcriptCorrectionSourceTranscriptPath:
            ".lime/runtime/transcripts/task-transcription-1.txt",
          transcriptCorrectionDiffSummary: expect.objectContaining({
            textChanged: true,
            originalSegmentCount: 1,
            correctedSegmentCount: 1,
            changedSegmentCount: 0,
            originalSpeakerCount: 1,
            correctedSpeakerCount: 1,
          }),
          transcriptSegmentsCorrected: [
            expect.objectContaining({
              id: "corrected-segment-1",
              startMs: 1000,
              endMs: 3000,
              speaker: "主持人",
              text: "欢迎来到 Lime 访谈节目。",
            }),
          ],
        }),
      }),
    );
    expect(
      (
        handleSaveArtifactDocument.mock.calls[0]?.[1].metadata as Record<
          string,
          unknown
        >
      ).transcriptCorrectionSavedAt,
    ).toEqual(expect.any(String));
  });

  it("编辑态命中关联 timeline 时应支持跳回执行过程", async () => {
    const onJumpToTimelineItem = vi.fn();
    const container = renderWorkbench(createArtifactDocumentArtifact(), {
      onSaveArtifactDocument: vi.fn().mockResolvedValue(undefined),
      threadItems: createArtifactTimelineItems(),
      onJumpToTimelineItem,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyBlockTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("正文块 1"));
    expect(bodyBlockTrigger).not.toBeUndefined();

    await act(async () => {
      bodyBlockTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const jumpButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("跳到过程"),
    );
    expect(jumpButton).not.toBeUndefined();

    await act(async () => {
      jumpButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onJumpToTimelineItem).toHaveBeenCalledWith("thread-item-body");
  });

  it("编辑态应支持触发 AI 改写当前块", async () => {
    const onArtifactBlockRewriteRun = vi.fn().mockResolvedValue({
      rawContent: '{"type":"artifact_rewrite_patch"}',
      suggestion: {
        summary: "压缩冗余表达，保留事实信息",
        block: {
          id: "body-1",
          type: "rich_text",
          contentFormat: "markdown",
          content: "AI 改写后的正文",
        },
        draft: {
          editorKind: "rich_text",
          markdown: "AI 改写后的正文",
        },
      },
    });
    const container = renderWorkbench(createArtifactDocumentArtifact(), {
      onSaveArtifactDocument: vi.fn().mockResolvedValue(undefined),
      threadItems: createArtifactTimelineItems(),
      onArtifactBlockRewriteRun,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyBlockTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("正文块 1"));
    expect(bodyBlockTrigger).not.toBeUndefined();

    await act(async () => {
      bodyBlockTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const rewriteButton = container.querySelector(
      '[data-testid="artifact-edit-ai-rewrite"]',
    ) as HTMLButtonElement | null;
    const rewriteInstructionInput = container.querySelector(
      '[data-testid="artifact-edit-rewrite-instruction"]',
    ) as HTMLTextAreaElement | null;
    expect(rewriteButton).not.toBeNull();
    expect(rewriteInstructionInput).not.toBeNull();

    await act(async () => {
      if (rewriteInstructionInput) {
        setTextControlValue(
          rewriteInstructionInput,
          "请保留事实，只压缩冗余表达，适合董事会 30 秒内扫读。",
        );
      }
      await Promise.resolve();
    });

    await act(async () => {
      rewriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onArtifactBlockRewriteRun).toHaveBeenCalledTimes(1);
    expect(onArtifactBlockRewriteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "artifact-1" }),
        entry: expect.objectContaining({
          blockId: "body-1",
          editorKind: "rich_text",
        }),
        draft: expect.objectContaining({
          editorKind: "rich_text",
          markdown: "正文内容",
        }),
        instruction: "请保留事实，只压缩冗余表达，适合董事会 30 秒内扫读。",
        timelineLink: expect.objectContaining({
          itemId: "thread-item-body",
          blockId: "body-1",
        }),
      }),
    );
    expect(container.textContent).toContain("本次改写建议");
    expect(container.textContent).toContain("压缩冗余表达，保留事实信息");

    const applyRewriteButton = container.querySelector(
      '[data-testid="artifact-edit-rewrite-apply"]',
    ) as HTMLButtonElement | null;
    expect(applyRewriteButton).not.toBeNull();

    await act(async () => {
      applyRewriteButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const editorInput = container.querySelector(
      '[data-testid="mock-notion-editor-input"]',
    ) as HTMLTextAreaElement | null;
    expect(editorInput?.value).toBe("AI 改写后的正文");
    expect(container.textContent).toContain(
      "已回填到当前草稿，确认无误后点击保存即可写回文稿。",
    );
  });

  it("AI 改写建议应支持直接保存为新版本", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const onArtifactBlockRewriteRun = vi.fn().mockResolvedValue({
      rawContent: '{"type":"artifact_rewrite_patch"}',
      suggestion: {
        summary: "压缩冗余表达，保留事实信息",
        block: {
          id: "body-1",
          type: "rich_text",
          contentFormat: "markdown",
          content: "AI 改写后的正文",
        },
        draft: {
          editorKind: "rich_text",
          markdown: "AI 改写后的正文",
        },
      },
    });
    const container = renderWorkbench(createArtifactDocumentArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
      threadItems: createArtifactTimelineItems(),
      onArtifactBlockRewriteRun,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyBlockTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("正文块 1"));
    expect(bodyBlockTrigger).not.toBeUndefined();

    await act(async () => {
      bodyBlockTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const rewriteButton = container.querySelector(
      '[data-testid="artifact-edit-ai-rewrite"]',
    ) as HTMLButtonElement | null;
    expect(rewriteButton).not.toBeNull();

    await act(async () => {
      rewriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const saveRewriteButton = container.querySelector(
      '[data-testid="artifact-edit-rewrite-save"]',
    ) as HTMLButtonElement | null;
    expect(saveRewriteButton).not.toBeNull();

    await act(async () => {
      saveRewriteButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-1" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "body-1",
            type: "rich_text",
            contentFormat: "markdown",
            content: "AI 改写后的正文",
            markdown: "AI 改写后的正文",
          }),
        ]),
        metadata: expect.objectContaining({
          currentVersionId: "artifact-document:demo:v3",
          currentVersionNo: 3,
          currentVersionDiff: expect.objectContaining({
            baseVersionId: "artifact-document:demo:v2",
            baseVersionNo: 2,
            targetVersionId: "artifact-document:demo:v3",
            targetVersionNo: 3,
            updatedCount: 1,
            changedBlocks: expect.arrayContaining([
              expect.objectContaining({
                blockId: "body-1",
                changeType: "updated",
                beforeText: "正文内容",
                afterText: "AI 改写后的正文",
              }),
            ]),
          }),
          versionHistory: expect.arrayContaining([
            expect.objectContaining({
              id: "artifact-document:demo:v3",
              versionNo: 3,
              summary: "更新 正文块 1",
              createdBy: "user",
            }),
          ]),
        }),
      }),
    );
    expect(container.textContent).toContain(
      "已把改写建议保存为当前文稿的新版本。",
    );
  });

  it("应支持在 workbench 中编辑提示块并回写 tone 与正文", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createStructuredEditableArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const calloutTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("风险提示"));
    expect(calloutTrigger).not.toBeUndefined();

    await act(async () => {
      calloutTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const toneInput = container.querySelector(
      '[data-testid="artifact-structured-edit-tone"]',
    ) as HTMLInputElement | null;
    const bodyInput = container.querySelector(
      '[data-testid="artifact-structured-edit-body"]',
    ) as HTMLTextAreaElement | null;

    expect(toneInput).not.toBeNull();
    expect(bodyInput).not.toBeNull();

    await act(async () => {
      if (toneInput) {
        setTextControlValue(toneInput, "critical");
      }
      if (bodyInput) {
        setTextControlValue(bodyInput, "交付周期偏长，需要立即治理。");
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveArtifactDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "artifact-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "callout-1",
            type: "callout",
            tone: "danger",
            variant: "critical",
            body: "交付周期偏长，需要立即治理。",
            content: "交付周期偏长，需要立即治理。",
            text: "交付周期偏长，需要立即治理。",
          }),
        ]),
      }),
    );
  });

  it("应支持在 workbench 中编辑 key points 与表格块", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createAdvancedEditableArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const keyPointsTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("关键结论"));
    expect(keyPointsTrigger).not.toBeUndefined();

    await act(async () => {
      keyPointsTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const keyPointsInput = container.querySelector(
      '[data-testid="artifact-structured-edit-items"]',
    ) as HTMLTextAreaElement | null;
    expect(keyPointsInput).not.toBeNull();

    await act(async () => {
      if (keyPointsInput) {
        setTextControlValue(
          keyPointsInput,
          "聚焦高质量增长\n优先治理交付瓶颈\n补齐来源引用",
        );
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "keypoints-1",
            type: "key_points",
            items: ["聚焦高质量增长", "优先治理交付瓶颈", "补齐来源引用"],
          }),
        ]),
      }),
    );

    const tableTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("经营对比表"),
    );
    expect(tableTrigger).not.toBeUndefined();

    await act(async () => {
      tableTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const columnsInput = container.querySelector(
      '[data-testid="artifact-structured-edit-columns"]',
    ) as HTMLTextAreaElement | null;
    const rowsInput = container.querySelector(
      '[data-testid="artifact-structured-edit-rows"]',
    ) as HTMLTextAreaElement | null;
    expect(columnsInput).not.toBeNull();
    expect(rowsInput).not.toBeNull();

    await act(async () => {
      if (columnsInput) {
        setTextControlValue(columnsInput, "维度 | 当前 | 下一步");
      }
      if (rowsInput) {
        setTextControlValue(
          rowsInput,
          "收入 | 稳定增长 | 继续看增量\n交付 | 偏慢 | 压缩周期",
        );
      }
      await Promise.resolve();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "table-1",
            type: "table",
            columns: ["维度", "当前", "下一步"],
            rows: [
              ["收入", "稳定增长", "继续看增量"],
              ["交付", "偏慢", "压缩周期"],
            ],
          }),
        ]),
      }),
    );
  });

  it("应支持在 workbench 中编辑 checklist、metric、quote 与 code block", async () => {
    const handleSaveArtifactDocument = vi.fn().mockResolvedValue(undefined);
    const container = renderWorkbench(createAdvancedEditableArtifact(), {
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("编辑"),
    );
    expect(editTrigger).not.toBeUndefined();

    await act(async () => {
      editTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const checklistTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("推进清单"));
    expect(checklistTrigger).not.toBeUndefined();

    await act(async () => {
      checklistTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const checklistInput = container.querySelector(
      '[data-testid="artifact-structured-edit-checklist"]',
    ) as HTMLTextAreaElement | null;
    expect(checklistInput).not.toBeNull();

    await act(async () => {
      if (checklistInput) {
        setTextControlValue(
          checklistInput,
          "doing | 梳理重点客户\n done | 压缩交付周期",
        );
      }
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "checklist-1",
            type: "checklist",
            items: [
              expect.objectContaining({ text: "梳理重点客户", state: "doing" }),
              expect.objectContaining({ text: "压缩交付周期", state: "done" }),
            ],
          }),
        ]),
      }),
    );

    const metricsTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("经营指标"));
    expect(metricsTrigger).not.toBeUndefined();

    await act(async () => {
      metricsTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const metricsInput = container.querySelector(
      '[data-testid="artifact-structured-edit-metrics"]',
    ) as HTMLTextAreaElement | null;
    expect(metricsInput).not.toBeNull();

    await act(async () => {
      if (metricsInput) {
        setTextControlValue(
          metricsInput,
          "ARR | 21% | 保持健康增长 | success\n交付时延 | 9 天 | 已接近目标 | warning",
        );
      }
      await Promise.resolve();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "metric-1",
            type: "metric_grid",
            metrics: [
              expect.objectContaining({
                label: "ARR",
                value: "21%",
                note: "保持健康增长",
                tone: "success",
              }),
              expect.objectContaining({
                label: "交付时延",
                value: "9 天",
                note: "已接近目标",
                tone: "warning",
              }),
            ],
          }),
        ]),
      }),
    );

    const quoteTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("COO 周会"),
    );
    expect(quoteTrigger).not.toBeUndefined();

    await act(async () => {
      quoteTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const quoteInput = container.querySelector(
      '[data-testid="artifact-structured-edit-quote"]',
    ) as HTMLTextAreaElement | null;
    const attributionInput = container.querySelector(
      '[data-testid="artifact-structured-edit-attribution"]',
    ) as HTMLInputElement | null;
    expect(quoteInput).not.toBeNull();
    expect(attributionInput).not.toBeNull();

    await act(async () => {
      if (quoteInput) {
        setTextControlValue(quoteInput, "季度交付效率必须进入经营复盘主线。");
      }
      if (attributionInput) {
        setTextControlValue(attributionInput, "CEO 周报");
      }
      await Promise.resolve();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "quote-1",
            type: "quote",
            text: "季度交付效率必须进入经营复盘主线。",
            quote: "季度交付效率必须进入经营复盘主线。",
            attribution: "CEO 周报",
          }),
        ]),
      }),
    );

    const codeTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行脚本"),
    );
    expect(codeTrigger).not.toBeUndefined();

    await act(async () => {
      codeTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const languageInput = container.querySelector(
      '[data-testid="artifact-structured-edit-language"]',
    ) as HTMLInputElement | null;
    const codeInput = container.querySelector(
      '[data-testid="artifact-structured-edit-code"]',
    ) as HTMLTextAreaElement | null;
    expect(languageInput).not.toBeNull();
    expect(codeInput).not.toBeNull();

    await act(async () => {
      if (languageInput) {
        setTextControlValue(languageInput, "ts");
      }
      if (codeInput) {
        setTextControlValue(codeInput, "await runArtifactWorkflow();");
      }
      await Promise.resolve();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSaveArtifactDocument).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ id: "artifact-advanced-structured" }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "code-1",
            type: "code_block",
            language: "ts",
            code: "await runArtifactWorkflow();",
          }),
        ]),
      }),
    );
  });
});
