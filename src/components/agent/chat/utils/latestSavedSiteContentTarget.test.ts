import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { resolveLatestProjectFileSavedSiteContentTargetFromMessages } from "./latestSavedSiteContentTarget";

function createAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || "assistant-message",
    role: "assistant",
    content: overrides.content || "",
    timestamp: overrides.timestamp || new Date("2026-04-09T12:00:00.000Z"),
    toolCalls: overrides.toolCalls,
    contentParts: overrides.contentParts,
    images: overrides.images,
    isThinking: overrides.isThinking,
    thinkingContent: overrides.thinkingContent,
    usage: overrides.usage,
    actionRequests: overrides.actionRequests,
    contextTrace: overrides.contextTrace,
    artifacts: overrides.artifacts,
    imageWorkbenchPreview: overrides.imageWorkbenchPreview,
    taskPreview: overrides.taskPreview,
    runtimeStatus: overrides.runtimeStatus,
    purpose: overrides.purpose,
  };
}

describe("latestSavedSiteContentTarget", () => {
  it("应从最新完成的站点工具结果里提取 project_file 目标", () => {
    const match = resolveLatestProjectFileSavedSiteContentTargetFromMessages([
      createAssistantMessage({
        id: "assistant-1",
        timestamp: new Date("2026-04-09T12:00:00.000Z"),
        toolCalls: [
          {
            id: "tool-site-1",
            name: "site_run_adapter",
            status: "completed",
            startTime: new Date("2026-04-09T12:00:00.000Z"),
            endTime: new Date("2026-04-09T12:00:01.000Z"),
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "site",
                saved_content: {
                  content_id: "content-1",
                  project_id: "project-1",
                  markdown_relative_path:
                    "exports/x-article-export/article/index.md",
                },
              },
            },
          },
        ],
      }),
    ]);

    expect(match).toEqual({
      messageId: "assistant-1",
      toolCallId: "tool-site-1",
      messageTimestampMs: new Date("2026-04-09T12:00:00.000Z").getTime(),
      target: {
        projectId: "project-1",
        contentId: "content-1",
        preferredTarget: "project_file",
        projectFile: {
          relativePath: "exports/x-article-export/article/index.md",
        },
      },
    });
  });

  it("应优先使用 contentParts 里的 tool_use，并忽略仅有 saved_content 但没有 markdown 的结果", () => {
    const match = resolveLatestProjectFileSavedSiteContentTargetFromMessages([
      createAssistantMessage({
        id: "assistant-1",
        timestamp: new Date("2026-04-09T12:00:00.000Z"),
        toolCalls: [
          {
            id: "tool-site-older",
            name: "site_run_adapter",
            status: "completed",
            startTime: new Date("2026-04-09T12:00:00.000Z"),
            endTime: new Date("2026-04-09T12:00:01.000Z"),
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "site",
                saved_content: {
                  content_id: "content-older",
                  project_id: "project-1",
                },
              },
            },
          },
        ],
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-site-latest",
              name: "site_run_adapter",
              status: "completed",
              startTime: new Date("2026-04-09T12:02:00.000Z"),
              endTime: new Date("2026-04-09T12:02:01.000Z"),
              result: {
                success: true,
                output: "ok",
                metadata: {
                  tool_family: "site",
                  saved_content: {
                    content_id: "content-latest",
                    project_id: "project-1",
                    markdown_relative_path:
                      "exports/x-article-export/latest/index.md",
                  },
                },
              },
            },
          },
        ],
      }),
    ]);

    expect(match?.toolCallId).toBe("tool-site-latest");
    expect(match?.target.projectFile?.relativePath).toBe(
      "exports/x-article-export/latest/index.md",
    );
  });

  it("没有 project_file 保存结果时应返回 null", () => {
    const match = resolveLatestProjectFileSavedSiteContentTargetFromMessages([
      createAssistantMessage({
        toolCalls: [
          {
            id: "tool-search-1",
            name: "ToolSearch",
            status: "completed",
            startTime: new Date("2026-04-09T12:00:00.000Z"),
            endTime: new Date("2026-04-09T12:00:01.000Z"),
            result: {
              success: true,
              output: "ok",
            },
          },
        ],
      }),
    ]);

    expect(match).toBeNull();
  });

  it("应忽略 preload 站点结果，优先选择真正完成后的导出文件", () => {
    const match = resolveLatestProjectFileSavedSiteContentTargetFromMessages([
      createAssistantMessage({
        id: "assistant-preload-filter",
        timestamp: new Date("2026-04-09T13:00:00.000Z"),
        toolCalls: [
          {
            id: "tool-site-final",
            name: "lime_site_run",
            status: "completed",
            startTime: new Date("2026-04-09T13:00:00.000Z"),
            endTime: new Date("2026-04-09T13:00:01.000Z"),
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "site",
                saved_content: {
                  content_id: "content-final",
                  project_id: "project-final",
                  markdown_relative_path:
                    "exports/x-article-export/final/index.md",
                },
              },
            },
          },
          {
            id: "tool-site-preload",
            name: "lime_site_run",
            status: "completed",
            startTime: new Date("2026-04-09T13:00:02.000Z"),
            endTime: new Date("2026-04-09T13:00:03.000Z"),
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "site",
                execution_origin: "preload",
                saved_content: {
                  content_id: "content-preload",
                  project_id: "project-final",
                  markdown_relative_path:
                    "exports/x-article-export/preload/index.md",
                },
              },
            },
          },
        ],
      }),
    ]);

    expect(match?.toolCallId).toBe("tool-site-final");
    expect(match?.target.projectFile?.relativePath).toBe(
      "exports/x-article-export/final/index.md",
    );
  });
});
