import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactRenderer } from "./ArtifactRenderer";
import {
  areLightweightRenderersRegistered,
  registerLightweightRenderers,
} from "./renderers";
import type { Artifact } from "@/lib/artifact/types";

interface MountedRenderer {
  container: HTMLDivElement;
  root: Root;
}

const mountedRenderers: MountedRenderer[] = [];

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  const content = overrides.content ?? "";
  return {
    id: overrides.id ?? "artifact-1",
    type: overrides.type ?? "document",
    title: overrides.title ?? "demo.md",
    content,
    status: overrides.status ?? "pending",
    meta: {
      filePath: overrides.meta?.filePath ?? "workspace/demo.md",
      filename: overrides.meta?.filename ?? "demo.md",
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

function renderArtifact(artifact: Artifact) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ArtifactRenderer artifact={artifact} tone="light" />);
  });

  mountedRenderers.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  if (!areLightweightRenderersRegistered()) {
    registerLightweightRenderers();
  }
});

afterEach(() => {
  while (mountedRenderers.length > 0) {
    const mounted = mountedRenderers.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("ArtifactRenderer 空内容态", () => {
  it("流式写入但暂无内容时应展示类型化骨架", () => {
    const container = renderArtifact(
      createArtifact({
        type: "code",
        title: "index.ts",
        status: "streaming",
        meta: {
          filePath: "workspace/index.ts",
          writePhase: "streaming",
          language: "typescript",
        },
      }),
    );

    const surface = container.querySelector(
      '[data-testid="artifact-empty-surface"]',
    );

    expect(surface).not.toBeNull();
    expect(surface?.getAttribute("data-empty-mode")).toBe("writing");
    expect(container.textContent).toContain("正在写入");
    expect(container.textContent).toContain("workspace/index.ts");
  });

  it("失败且没有内容时应展示错误解释态", () => {
    const container = renderArtifact(
      createArtifact({
        status: "error",
        error: "保存失败",
        meta: {
          filePath: "workspace/broken.md",
          writePhase: "failed",
        },
      }),
    );

    const surface = container.querySelector(
      '[data-testid="artifact-empty-surface"]',
    );

    expect(surface?.getAttribute("data-empty-mode")).toBe("failed");
    expect(container.textContent).toContain("写入未完成");
    expect(container.textContent).toContain("保存失败");
  });

  it("命中 ArtifactDocument 协议时应渲染结构化阅读面", async () => {
    const container = renderArtifact(
      createArtifact({
        content: JSON.stringify({
          schemaVersion: "artifact_document.v1",
          artifactId: "artifact-doc-1",
          kind: "analysis",
          title: "结构化报告标题",
          status: "ready",
          language: "zh-CN",
          summary: "摘要信息",
          blocks: [
            {
              id: "hero-1",
              type: "hero_summary",
              summary: "顶部摘要",
            },
            {
              id: "body-1",
              type: "rich_text",
              markdown: "正文段落",
            },
          ],
          sources: [],
          metadata: {
            theme: "knowledge",
          },
        }),
        status: "complete",
        meta: {
          filePath: "workspace/report.json",
          filename: "report.json",
          language: "json",
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="artifact-document-renderer"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("结构化报告标题");
    expect(container.textContent).toContain("正文段落");
  });

  it("content 为空但 metadata 携带 artifactDocument 时也应渲染结构化阅读面", async () => {
    const container = renderArtifact(
      createArtifact({
        content: "",
        status: "complete",
        meta: {
          filePath: ".lime/artifacts/thread-1/report.artifact.json",
          filename: "report.artifact.json",
          artifactSchema: "artifact_document.v1",
          artifactDocument: {
            schemaVersion: "artifact_document.v1",
            artifactId: "artifact-doc-2",
            kind: "report",
            title: "落盘结构化周报",
            status: "ready",
            language: "zh-CN",
            summary: "来自 metadata 的摘要",
            blocks: [
              {
                id: "hero-1",
                type: "hero_summary",
                summary: "来自 metadata 的摘要",
              },
              {
                id: "body-1",
                type: "rich_text",
                markdown: "落盘后的正文内容",
              },
            ],
            sources: [],
            metadata: {
              theme: "knowledge",
            },
          },
          language: "json",
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="artifact-document-renderer"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("落盘结构化周报");
    expect(container.textContent).toContain("落盘后的正文内容");
  });
});
