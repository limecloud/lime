import { describe, expect, it } from "vitest";
import { buildMessageInspirationDraft } from "./messageInspirationDraft";

describe("buildMessageInspirationDraft", () => {
  it("应把助手结果整理成成果类灵感沉淀请求", () => {
    const result = buildMessageInspirationDraft({
      messageId: "msg-1",
      sessionId: "session-1",
      content: `
# 爆款复盘模板

先保留开头钩子，再展开三段论结构，最后落到行动建议。
`,
    });

    expect(result).toMatchObject({
      category: "experience",
      section: "experience",
      title: "爆款复盘模板",
      request: {
        session_id: "session-1",
        title: "爆款复盘模板",
        summary: "先保留开头钩子，再展开三段论结构，最后落到行动建议",
        category: "experience",
        confidence: 0.86,
        importance: 7,
      },
    });
  });

  it("命中风格关键词时应落到风格分类，并提取标签", () => {
    const result = buildMessageInspirationDraft({
      messageId: "msg-2",
      content: `
## 夏日视频风格建议

整体语气要轻快、清爽，画面氛围偏明亮。
标签：小红书，夏日，轻快口播
`,
    });

    expect(result).toMatchObject({
      category: "identity",
      section: "identity",
      request: {
        session_id: "msg-2",
        category: "identity",
        tags: ["小红书", "夏日", "轻快口播"],
      },
    });
  });

  it("来自灵感库回放时应优先沿用原有分类与标签", () => {
    const result = buildMessageInspirationDraft(
      {
        messageId: "msg-4",
        content: `
继续整理成一版更完整的结果。
标签：转化、口播
`,
      },
      {
        creationReplay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory",
          },
          data: {
            category: "identity",
            title: "夏日短视频语气",
            summary: "整体语气要轻快、清爽。",
            tags: ["小红书", "口播"],
          },
        },
      },
    );

    expect(result).toMatchObject({
      category: "identity",
      section: "identity",
      request: {
        category: "identity",
        tags: ["小红书", "口播", "转化"],
      },
    });
  });

  it("空白内容不应生成灵感沉淀请求", () => {
    expect(
      buildMessageInspirationDraft({
        messageId: "msg-3",
        content: "   ",
      }),
    ).toBeNull();
  });
});
