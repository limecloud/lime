import { describe, expect, it } from "vitest";

import { ARTIFACT_DOCUMENT_SCHEMA_VERSION } from "@/lib/artifact-document";
import {
  areArtifactProtocolPathsEquivalent,
  extractArtifactProtocolPaths,
  extractArtifactProtocolPathsFromRecord,
  extractArtifactProtocolPathsFromValue,
  hasArtifactProtocolDocumentMetadata,
  hasArtifactProtocolMetadata,
  isArtifactProtocolImagePath,
  normalizeArtifactProtocolPath,
  resolveArtifactProtocolDocumentPayload,
  resolveArtifactProtocolFilePath,
  resolveArtifactProtocolPreviewText,
} from "./index";

describe("artifact-protocol", () => {
  const artifactDocument = {
    schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
    artifactId: "artifact-doc-1",
    kind: "analysis",
    title: "结构化结论",
    status: "ready",
    language: "zh-CN",
    summary: "这是结构化摘要。",
    blocks: [
      {
        id: "hero-1",
        type: "hero_summary",
        summary: "这是结构化摘要。",
      },
    ],
    sources: [],
    metadata: {
      theme: "general",
    },
  };

  it("应复用 artifact-document 作为文档载荷事实源", () => {
    const document = resolveArtifactProtocolDocumentPayload({
      metadata: {
        artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
        artifactDocument,
      },
    });

    expect(document?.artifactId).toBe("artifact-doc-1");
    expect(
      hasArtifactProtocolDocumentMetadata({
        artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
      }),
    ).toBe(true);
    expect(resolveArtifactProtocolPreviewText(document!)).toBe(
      "这是结构化摘要。",
    );
  });

  it("应统一提取 snake_case 与 camelCase 的产物路径键", () => {
    expect(
      extractArtifactProtocolPaths({
        artifact_paths: [" .lime/artifacts/thread-1/report.artifact.json "],
        artifactPath: ".lime\\artifacts\\thread-1\\report.artifact.json",
        filePath: ".lime/artifacts/thread-1/outline.md",
        target_path: "workspace/result.md",
        sourceFileName: "workspace/final.md",
      }),
    ).toEqual([
      ".lime/artifacts/thread-1/outline.md",
      "workspace/result.md",
      ".lime/artifacts/thread-1/report.artifact.json",
      "workspace/final.md",
    ]);
  });

  it("应允许从未知 record 统一提取产物路径", () => {
    expect(
      extractArtifactProtocolPathsFromRecord({
        artifact_paths: ["workspace/demo.md"],
        artifactPath: "workspace\\demo.cover.png",
      }),
    ).toEqual(["workspace/demo.cover.png", "workspace/demo.md"]);
    expect(extractArtifactProtocolPathsFromRecord(null)).toEqual([]);
  });

  it("应递归提取嵌套对象中的协议路径并兼容 absolute_path", () => {
    expect(
      extractArtifactProtocolPathsFromValue({
        payload: {
          absolute_path: " /tmp\\demo.md ",
        },
        result: [
          {
            artifact_paths: ["workspace/final.md"],
          },
        ],
      }),
    ).toEqual(["/tmp/demo.md", "workspace/final.md"]);
  });

  it("应把文档与路径都视为 artifact protocol metadata", () => {
    expect(
      hasArtifactProtocolMetadata({
        artifactPath: "workspace/result.md",
      }),
    ).toBe(true);
    expect(
      hasArtifactProtocolMetadata({
        artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
      }),
    ).toBe(true);
    expect(hasArtifactProtocolMetadata(undefined)).toBe(false);
  });

  it("应把文件名、相对路径与绝对路径识别为同一路径", () => {
    expect(
      areArtifactProtocolPathsEquivalent(
        "output_image.jpg",
        "/Users/coso/.lime/tasks/image/output_image.jpg",
      ),
    ).toBe(true);
    expect(
      areArtifactProtocolPathsEquivalent(
        "./.lime/tasks/image/output_image.jpg",
        ".lime/tasks/image/output_image.jpg",
      ),
    ).toBe(true);
    expect(
      areArtifactProtocolPathsEquivalent(
        "content-posts/cover.png",
        "assets/cover.png",
      ),
    ).toBe(false);
  });

  it("应规范化协议路径并识别二进制图片文件", () => {
    expect(
      normalizeArtifactProtocolPath(" .\\.lime\\tasks\\image\\cover.jpg "),
    ).toBe("./.lime/tasks/image/cover.jpg");
    expect(isArtifactProtocolImagePath("output_image.jpg")).toBe(true);
    expect(isArtifactProtocolImagePath("diagram.svg")).toBe(false);
  });

  it("应统一处理 artifact 的文件路径回退顺序", () => {
    expect(
      resolveArtifactProtocolFilePath({
        title: "report.artifact.json",
        meta: {
          filePath: " .lime/artifacts/thread-1/report.artifact.json ",
          filename: "fallback.json",
        },
      }),
    ).toBe(".lime/artifacts/thread-1/report.artifact.json");
    expect(
      resolveArtifactProtocolFilePath({
        title: "report.artifact.json",
        meta: {
          filename: "fallback.json",
        },
      }),
    ).toBe("fallback.json");
  });
});
