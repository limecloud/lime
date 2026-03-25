import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { buildThemeWorkbenchWorkflowSteps } from "./themeWorkbenchHelpers";

describe("themeWorkbenchHelpers", () => {
  it("应通过 artifact protocol 解析嵌套参数中的写文件路径标题", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "/social_post_with_cover 请继续生成社媒稿",
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
                artifact_paths: ["social-posts\\final.md"],
              },
            }),
            status: "completed",
            startTime: new Date("2026-03-24T15:00:01.500Z"),
            endTime: new Date("2026-03-24T15:00:02.000Z"),
          },
        ],
      },
    ];

    const workflowSteps = buildThemeWorkbenchWorkflowSteps(
      messages,
      null,
      true,
      {},
    );

    expect(workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "写入 social-posts/final.md",
          status: "completed",
        }),
      ]),
    );
  });
});
