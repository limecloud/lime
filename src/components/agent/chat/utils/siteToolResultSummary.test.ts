import { describe, expect, it } from "vitest";
import {
  resolveSiteSavedContentTarget,
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
});
