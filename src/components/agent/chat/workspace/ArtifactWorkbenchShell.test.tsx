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
        markdown: "正文内容",
        sourceIds: ["source-1"],
      },
    ],
    sources: [
      {
        id: "source-1",
        title: "OpenAI Blog",
        url: "https://openai.com",
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
        markdown: "这里是详细分析。",
      },
      {
        id: "callout-1",
        type: "callout",
        title: "风险提示",
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
  overrides: Partial<React.ComponentProps<typeof ArtifactWorkbenchShell>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
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
        {...overrides}
      />,
    );
  });

  mountedShells.push({ container, root });
  return container;
}

function renderWorkbench(
  artifact: Artifact,
  overrides: Partial<React.ComponentProps<typeof ArtifactWorkbenchShell>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function WorkbenchHarness() {
    const controller = useArtifactWorkbenchDocumentController({
      artifact,
      onSaveArtifactDocument: overrides.onSaveArtifactDocument,
      threadItems: overrides.threadItems,
      focusedBlockId: overrides.focusedBlockId,
      blockFocusRequestKey: overrides.blockFocusRequestKey,
      onJumpToTimelineItem: overrides.onJumpToTimelineItem,
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
          {...overrides}
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
      expect(buttons.find((button) => button.textContent?.includes(label))).toBeUndefined();
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

    const overviewTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("概览"),
    );
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已整理为可继续编辑的草稿");
    expect(container.textContent).toContain(
      "系统已先把可用正文整理成恢复稿。你可以直接继续编辑，确认内容顺畅后，再手动标记为可阅读。",
    );
    expect(container.textContent).toContain("恢复稿");
    expect(
      container.querySelector('[data-testid="artifact-recovery-continue-editing"]'),
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

    const overviewTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("概览"),
    );
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

    const overviewTrigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("概览"),
    );
    expect(overviewTrigger).not.toBeUndefined();

    await act(async () => {
      overviewTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const markReadyButton = container.querySelector(
      '[data-testid="artifact-recovery-mark-ready"]',
    ) as HTMLButtonElement | null;
    expect(markReadyButton).not.toBeNull();

    await act(async () => {
      markReadyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
            markdown: "更新后的正文",
          }),
        ]),
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
            tone: "critical",
            variant: "critical",
            content: "交付周期偏长，需要立即治理。",
            text: "交付周期偏长，需要立即治理。",
          }),
        ]),
      }),
    );
  });
});
