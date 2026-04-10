import { describe, expect, it } from "vitest";
import {
  hasMeaningfulSiteToolResultSignal,
  isPreloadSiteToolResultMetadata,
  normalizeSiteToolResultSummary,
  resolveSiteSavedContentTarget,
  resolveSiteSavedContentTargetFromMetadata,
  resolveSiteSavedContentTargetFromRunResult,
} from "./siteToolResultSummary";

describe("siteToolResultSummary", () => {
  it("应从站点运行结果解析 Markdown 导出目标", () => {
    expect(
      resolveSiteSavedContentTargetFromRunResult({
        saved_content: {
          content_id: "content-x-1",
          project_id: "project-x-1",
          title: "Google Cloud 文章",
          markdown_relative_path:
            "exports/x-article-export/google-cloud/index.md",
        },
        saved_project_id: "project-fallback",
      }),
    ).toEqual({
      projectId: "project-x-1",
      contentId: "content-x-1",
      title: "Google Cloud 文章",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/google-cloud/index.md",
      },
    });
  });

  it("应从统一 summary 解析 saved content target", () => {
    expect(
      resolveSiteSavedContentTarget({
        savedContent: {
          contentId: "content-x-2",
          projectId: "project-x-2",
          title: "X 长文",
          markdownRelativePath: "exports/x-article-export/article/index.md",
        },
      }),
    ).toEqual({
      projectId: "project-x-2",
      contentId: "content-x-2",
      title: "X 长文",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/article/index.md",
      },
    });
  });

  it("应直接从 metadata 解析 saved content target", () => {
    expect(
      resolveSiteSavedContentTargetFromMetadata({
        tool_family: "site",
        saved_content: {
          content_id: "content-x-2b",
          project_id: "project-x-2b",
          markdown_relative_path: "exports/x-article-export/direct/index.md",
        },
      }),
    ).toEqual({
      projectId: "project-x-2b",
      contentId: "content-x-2b",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/direct/index.md",
      },
    });
  });

  it("系统 preload 结果不应被视为最终可打开的保存目标", () => {
    expect(
      resolveSiteSavedContentTargetFromMetadata({
        tool_family: "site",
        execution_origin: "preload",
        saved_content: {
          content_id: "content-preload-1",
          project_id: "project-preload-1",
          markdown_relative_path: "exports/x-article-export/preload/index.md",
        },
      }),
    ).toBeNull();
    expect(
      isPreloadSiteToolResultMetadata({
        tool_family: "site",
        preload: true,
      }),
    ).toBe(true);
  });

  it("应将保存相关 metadata 识别为有意义结果信号", () => {
    expect(
      hasMeaningfulSiteToolResultSignal({
        tool_family: "site",
        saved_content: {
          content_id: "content-x-2c",
          project_id: "project-x-2c",
        },
      }),
    ).toBe(true);
    expect(hasMeaningfulSiteToolResultSignal(undefined)).toBe(false);
  });

  it("应将 legacy 项目目录展示规范到 lime 主路径", () => {
    expect(
      normalizeSiteToolResultSummary({
        tool_family: "site",
        saved_content: {
          content_id: "content-x-3",
          project_id: "project-x-3",
          project_root_path: "/Users/coso/.proxycast/projects/default",
        },
      })?.savedContent?.projectRootPath,
    ).toBe("/Users/coso/Library/Application Support/lime/projects/default");
  });
});
