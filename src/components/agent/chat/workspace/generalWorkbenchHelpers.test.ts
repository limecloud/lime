import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import {
  applyBackendGeneralWorkbenchDocumentState,
  buildGeneralWorkbenchWorkflowSteps,
  readPersistedGeneralWorkbenchDocument,
} from "./generalWorkbenchHelpers";

describe("generalWorkbenchHelpers", () => {
  it("应通过 artifact protocol 解析嵌套参数中的写文件路径标题", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "/content_post_with_cover 请继续生成社媒稿",
        timestamp: new Date("2026-03-24T15:00:00.000Z"),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-24T15:00:01.000Z"),
        isThinking: true,
        toolCalls: [
          {
            id: "tool-write-1",
            name: "write_file",
            arguments: JSON.stringify({
              payload: {
                artifact_paths: ["content-posts\\final.md"],
              },
            }),
            status: "completed",
            startTime: new Date("2026-03-24T15:00:01.500Z"),
            endTime: new Date("2026-03-24T15:00:02.000Z"),
          },
        ],
      },
    ];

    const workflowSteps = buildGeneralWorkbenchWorkflowSteps(
      messages,
      null,
      true,
      {},
    );

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "写入 content-posts/final.md",
          status: "completed",
        }),
      ]),
    );
  });

  it("应为 lime media CLI bash 调用生成明确的媒体任务标题", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "/image_generate 请生成配图",
        timestamp: new Date("2026-04-03T10:00:00.000Z"),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-03T10:00:01.000Z"),
        isThinking: true,
        toolCalls: [
          {
            id: "tool-bash-1",
            name: "Bash",
            arguments: JSON.stringify({
              command:
                "lime media image generate --prompt '未来城市插图' --json",
            }),
            status: "completed",
            startTime: new Date("2026-04-03T10:00:01.500Z"),
            endTime: new Date("2026-04-03T10:00:02.000Z"),
          },
        ],
      },
    ];

    const workflowSteps = buildGeneralWorkbenchWorkflowSteps(
      messages,
      null,
      true,
      {},
    );

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "提交配图任务",
          status: "completed",
        }),
      ]),
    );
  });

  it("应读取后端持久化的工作区编排版本元数据", () => {
    const persisted = readPersistedGeneralWorkbenchDocument({
      general_workbench_document_v1: {
        currentVersionId: "artifact-document:auto-report:v2",
        versions: [
          {
            id: "artifact-document:auto-report:v1",
            createdAt: 1710000000000,
            description: "第一版",
          },
          {
            id: "artifact-document:auto-report:v2",
            createdAt: 1710003600000,
            description: "第二版",
          },
        ],
        versionStatusMap: {
          "artifact-document:auto-report:v1": "merged",
          "artifact-document:auto-report:v2": "pending",
        },
      },
    });

    expect(persisted).toEqual({
      currentVersionId: "artifact-document:auto-report:v2",
      versions: [
        {
          id: "artifact-document:auto-report:v1",
          content: "",
          createdAt: 1710000000000,
          description: "第一版",
        },
        {
          id: "artifact-document:auto-report:v2",
          content: "",
          createdAt: 1710003600000,
          description: "第二版",
        },
      ],
      versionStatusMap: {
        "artifact-document:auto-report:v1": "merged",
        "artifact-document:auto-report:v2": "pending",
      },
    });
  });

  it("应兼容读取旧的 general workbench 元数据 alias", () => {
    const persisted = readPersistedGeneralWorkbenchDocument({
      theme_workbench_document_v1: {
        currentVersionId: "artifact-document:auto-report:v1",
        versions: [
          {
            id: "artifact-document:auto-report:v1",
            createdAt: 1710000000000,
            description: "第一版",
          },
        ],
      },
    });

    expect(persisted?.currentVersionId).toBe("artifact-document:auto-report:v1");
  });

  it("应把后端工作区编排状态与正文恢复为当前版本", () => {
    const result = applyBackendGeneralWorkbenchDocumentState(
      {
        type: "document",
        content: "",
        platform: "markdown",
        versions: [
          {
            id: "draft-initial",
            content: "",
            createdAt: 1709990000000,
            description: "初始草稿",
          },
        ],
        currentVersionId: "draft-initial",
        isEditing: true,
      } as never,
      {
        content_id: "content-1",
        current_version_id: "artifact-document:auto-report:v2",
        version_count: 2,
        versions: [
          {
            id: "artifact-document:auto-report:v1",
            created_at: 1710000000000,
            description: "第一版",
            status: "merged",
            is_current: false,
          },
          {
            id: "artifact-document:auto-report:v2",
            created_at: 1710003600000,
            description: "第二版",
            status: "pending",
            is_current: true,
          },
        ],
      },
      "# 自动化日报\n\n这里是最新正文。",
    );

    expect(result).not.toBeNull();
    expect(result?.state.type).toBe("document");
    if (result?.state.type !== "document") {
      throw new Error("应返回 document state");
    }
    expect(result.state.currentVersionId).toBe(
      "artifact-document:auto-report:v2",
    );
    expect(result.state.content).toContain("这里是最新正文");
    expect(result.state.versions).toEqual([
      {
        id: "artifact-document:auto-report:v1",
        content: "",
        createdAt: 1710000000000,
        description: "第一版",
      },
      {
        id: "artifact-document:auto-report:v2",
        content: "# 自动化日报\n\n这里是最新正文。",
        createdAt: 1710003600000,
        description: "第二版",
      },
    ]);
    expect(result.statusMap).toEqual({
      "artifact-document:auto-report:v1": "merged",
      "artifact-document:auto-report:v2": "pending",
    });
  });
});
