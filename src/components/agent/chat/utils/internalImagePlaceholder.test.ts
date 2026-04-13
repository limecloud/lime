import { describe, expect, it } from "vitest";

import {
  sanitizeContentPartsForDisplay,
  sanitizeMessageTextForDisplay,
} from "./internalImagePlaceholder";
import type { ContentPart } from "../types";

describe("internalImagePlaceholder", () => {
  it("应清理紧邻工具调用的调度自述文本", () => {
    const contentParts: ContentPart[] = [
      {
        type: "text",
        text: "ToolSearch 只返回了元数据，让我直接调用 WebSearch 进行多组检索。",
      },
      {
        type: "tool_use",
        toolCall: {
          id: "tool-narration-strip",
          name: "WebSearch",
          arguments: "{}",
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-04-13T09:00:00.000Z"),
        },
      },
      {
        type: "text",
        text: "已经整理出 3 个可信来源。",
      },
    ];

    expect(
      sanitizeContentPartsForDisplay(contentParts, {
        role: "assistant",
      }),
    ).toEqual([
      contentParts[1],
      contentParts[2],
    ]);
  });

  it("应清理紧邻工具调用的页面操作自述", () => {
    const contentParts: ContentPart[] = [
      {
        type: "tool_use",
        toolCall: {
          id: "tool-narration-page",
          name: "webReader",
          arguments: "{}",
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-04-13T09:01:00.000Z"),
        },
      },
      {
        type: "text",
        text: "我已经打开 GitHub 搜索页，接下来开始筛选结果。",
      },
      {
        type: "text",
        text: "筛到两个官方仓库入口。",
      },
    ];

    expect(
      sanitizeContentPartsForDisplay(contentParts, {
        role: "assistant",
      }),
    ).toEqual([
      contentParts[0],
      contentParts[2],
    ]);
  });

  it("带结论的正常说明不应被误删", () => {
    const contentParts: ContentPart[] = [
      {
        type: "text",
        text: "我用 WebSearch 查到 3 个官方来源，结论是目前只支持桌面端。",
      },
      {
        type: "tool_use",
        toolCall: {
          id: "tool-narration-keep",
          name: "WebSearch",
          arguments: "{}",
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-04-13T09:02:00.000Z"),
        },
      },
    ];

    expect(
      sanitizeContentPartsForDisplay(contentParts, {
        role: "assistant",
      }),
    ).toEqual(contentParts);
  });

  it("不挨着工具调用的普通说明不应被清理", () => {
    const contentParts: ContentPart[] = [
      {
        type: "text",
        text: "ToolSearch 用于查询当前可用工具，这里是在解释概念。",
      },
      {
        type: "text",
        text: "下面再继续说明使用方式。",
      },
    ];

    expect(
      sanitizeContentPartsForDisplay(contentParts, {
        role: "assistant",
      }),
    ).toEqual(contentParts);
  });

  it("普通消息文本清洗仍不应误删工具说明", () => {
    const text =
      "ToolSearch 用于查询当前可用工具，这里是在给用户解释概念。";

    expect(
      sanitizeMessageTextForDisplay(text, {
        role: "assistant",
      }),
    ).toBe(text);
  });
});
