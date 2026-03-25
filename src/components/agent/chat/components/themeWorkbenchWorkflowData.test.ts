import { describe, expect, it } from "vitest";
import {
  buildThemeWorkbenchActivityLogGroups,
  parseThemeWorkbenchRunMetadataSummary,
} from "./themeWorkbenchWorkflowData";

describe("themeWorkbenchWorkflowData", () => {
  it("应通过 artifact protocol 统一解析运行元数据里的产物路径", () => {
    expect(
      parseThemeWorkbenchRunMetadataSummary(
        JSON.stringify({
          workflow: "social",
          execution_id: "exec-1",
          version_id: "version-1",
          stages: ["write_mode"],
          artifact_paths: [" social-posts/demo.md "],
          artifactPath: "social-posts\\demo-cover.png",
          filePath: "social-posts/summary.md",
        }),
      ),
    ).toEqual({
      workflow: "social",
      executionId: "exec-1",
      versionId: "version-1",
      stages: ["write_mode"],
      artifactPaths: [
        "social-posts/summary.md",
        "social-posts/demo-cover.png",
        "social-posts/demo.md",
      ],
    });
  });

  it("应合并同一运行日志中的产物路径并保持规范化", () => {
    expect(
      buildThemeWorkbenchActivityLogGroups([
        {
          id: "log-1",
          name: "排版优化",
          status: "running",
          timeLabel: "10:30",
          runId: "run-1",
          artifactPaths: [" social-posts/demo.md "],
        },
        {
          id: "log-2",
          name: "排版优化",
          status: "completed",
          timeLabel: "10:31",
          runId: "run-1",
          artifactPaths: ["social-posts/demo.md", "social-posts/demo-cover.png"],
        },
      ])[0]?.artifactPaths,
    ).toEqual(["social-posts/demo.md", "social-posts/demo-cover.png"]);
  });
});
