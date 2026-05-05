import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactRenderer } from "./ArtifactRenderer";
import { ArtifactDocumentRenderer } from "./renderers/ArtifactDocumentRenderer";
import {
  areLightweightRenderersRegistered,
  registerLightweightRenderers,
} from "./renderers";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
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

function renderArtifactDocument(artifactDocument: ArtifactDocumentV1) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ArtifactDocumentRenderer document={artifactDocument} tone="light" />,
    );
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

  it("canvas:design 应直接委托到图层设计画布，不依赖轻量渲染器注册", async () => {
    const container = renderArtifact(
      createArtifact({
        type: "canvas:design",
        title: "design.json",
        status: "complete",
        content: JSON.stringify({
          id: "design-artifact-ui",
          title: "Artifact 图层海报",
          canvas: { width: 1080, height: 1440 },
          layers: [
            {
              id: "headline",
              name: "标题层",
              type: "text",
              text: "可编辑标题",
              x: 120,
              y: 120,
              width: 840,
              height: 120,
              zIndex: 4,
            },
          ],
          assets: [],
          editHistory: [],
          createdAt: "2026-05-05T00:00:00.000Z",
          updatedAt: "2026-05-05T00:00:00.000Z",
        }),
        meta: {
          filePath: "workspace/design.json",
          filename: "design.json",
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("图层设计 Canvas");
    expect(container.textContent).toContain("LayeredDesignDocument");
    expect(container.textContent).toContain("Artifact 图层海报");
    expect(container.textContent).toContain("标题层");
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
              contentFormat: "markdown",
              content: "正文段落",
            },
          ],
          sources: [],
          metadata: {
            theme: "general",
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
    expect(container.textContent).toContain("主题 通用");
    expect(
      container.querySelector(
        '[data-testid="artifact-document-renderer"] article',
      )?.className,
    ).toContain("max-w-[1100px]");
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
                contentFormat: "markdown",
                content: "落盘后的正文内容",
              },
            ],
            sources: [],
            metadata: {
              theme: "general",
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
    expect(container.textContent).toContain("主题 通用");
  });

  it("结构化阅读面应渲染摘要卡、统计卡与来源附录", async () => {
    const container = renderArtifact(
      createArtifact({
        content: JSON.stringify({
          schemaVersion: "artifact_document.v1",
          artifactId: "artifact-doc-3",
          kind: "comparison",
          title: "Hermes Engine 评估",
          status: "ready",
          language: "zh-CN",
          summary: "对比不同引擎的交付稳定性与编排成本。",
          blocks: [
            {
              id: "hero-1",
              type: "hero_summary",
              eyebrow: "执行摘要",
              title: "优先选择稳定交付链路",
              summary: "先收口主链，再决定是否引入更激进的并发策略。",
              highlights: ["稳定性优先", "治理成本更低"],
            },
            {
              id: "section-1",
              type: "section_header",
              title: "核心判断",
              description: "按交付可预测性与维护成本排序。",
            },
            {
              id: "body-1",
              type: "rich_text",
              contentFormat: "markdown",
              content: "正文段落",
            },
          ],
          sources: [
            {
              id: "source-1",
              type: "web",
              label: "OpenAI Blog",
              snippet: "作为模型能力背景参考",
              locator: {
                url: "https://openai.com",
              },
            },
          ],
          metadata: {
            theme: "general",
            audience: "产品与工程负责人",
            intent: "技术选型",
          },
        }),
        status: "complete",
        meta: {
          filePath: "workspace/hermes-report.json",
          filename: "hermes-report.json",
          language: "json",
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("执行摘要");
    expect(container.textContent).toContain("要点 01");
    expect(container.textContent).toContain("结构块");
    expect(container.textContent).toContain("亮点");
    expect(container.textContent).toContain("来源附录");
    expect(container.textContent).toContain("OpenAI Blog");
    expect(container.textContent).toContain("主题 通用");
    expect(container.textContent).not.toContain("主题 general");
    expect(container.querySelector("#artifact-block-hero-1")).not.toBeNull();
  });

  it("结构化阅读面应复用 CodeRenderer 并在图片缺失时显示占位图", async () => {
    const container = renderArtifactDocument({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-doc-4",
      kind: "analysis",
      title: "协议映射回归",
      status: "ready",
      language: "zh-CN",
      blocks: [
        {
          id: "code-1",
          type: "code_block",
          title: "示例代码",
          language: "typescript",
          code: "const answer = 42;",
        },
        {
          id: "image-1",
          type: "image",
          title: "架构图",
          url: "",
          caption: "等待上传正式图片",
        },
      ],
      sources: [],
      metadata: {
        theme: "general",
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector(".code-renderer")).not.toBeNull();
    expect(container.textContent).toContain("示例代码");
    expect(container.textContent).toContain("typescript");
    expect(container.textContent).toContain("复制");
    expect(container.textContent).toContain("图片占位图");
    expect(container.textContent).toContain("等待上传正式图片");
  });

  it("结构块缺少结构数据时应回退为 rich_text，并删除 citation_list 空块", async () => {
    const container = renderArtifactDocument({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-doc-5",
      kind: "report",
      title: "回退行为回归",
      status: "ready",
      language: "zh-CN",
      blocks: [
        {
          id: "table-fallback-1",
          type: "table",
          title: "对比表",
          columns: [],
          rows: [],
          content: "备用表格文本",
        },
        {
          id: "citation-drop-1",
          type: "citation_list",
          title: "不应出现的参考来源",
          items: [],
        },
      ],
      sources: [],
      metadata: {
        theme: "general",
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("备用表格文本");
    expect(container.textContent).not.toContain("不应出现的参考来源");
  });
});
