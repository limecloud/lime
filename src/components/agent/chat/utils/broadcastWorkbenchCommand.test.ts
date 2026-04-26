import { describe, expect, it } from "vitest";
import { parseBroadcastWorkbenchCommand } from "./broadcastWorkbenchCommand";

describe("parseBroadcastWorkbenchCommand", () => {
  it("应解析带显式字段的 @播报 命令", () => {
    const result = parseBroadcastWorkbenchCommand(
      "@播报 标题: 创始人周报 听众: AI 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
    );

    expect(result).toMatchObject({
      trigger: "@播报",
      title: "创始人周报",
      audience: "AI 创业者",
      tone: "口语化",
      durationHintMinutes: 5,
      prompt: "把下面文章整理成播报文本",
      content: "把下面文章整理成播报文本",
    });
  });

  it("应解析带正文分隔的 @播客 命令", () => {
    const result = parseBroadcastWorkbenchCommand(
      "@播客 听众: 产品经理 语气: 专业克制 正文: 这是今天的文章正文第一段。\n这是第二段。",
    );

    expect(result).toMatchObject({
      trigger: "@播客",
      audience: "产品经理",
      tone: "专业克制",
      prompt: "",
      content: "这是今天的文章正文第一段。\n这是第二段。",
    });
  });

  it("应兼容 @broadcast 英文触发", () => {
    const result = parseBroadcastWorkbenchCommand(
      "@broadcast audience: founders tone: friendly 8 minutes turn this article into an audio-ready brief",
    );

    expect(result).toMatchObject({
      trigger: "@broadcast",
      audience: "founders",
      tone: "friendly",
      durationHintMinutes: 8,
      prompt: "this article into an audio-ready brief",
    });
  });

  it("应兼容 @Speaker 1，并继续走播报主链", () => {
    const result = parseBroadcastWorkbenchCommand(
      "@Speaker 1 audience: founders tone: friendly 8 minutes turn this article into an audio-ready brief",
    );

    expect(result).toMatchObject({
      trigger: "@Speaker 1",
      audience: "founders",
      tone: "friendly",
      durationHintMinutes: 8,
      prompt: "this article into an audio-ready brief",
    });
  });

  it("非播报命令应返回空", () => {
    expect(parseBroadcastWorkbenchCommand("@视频 做一条新品视频")).toBeNull();
  });
});
