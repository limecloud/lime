import { describe, expect, it } from "vitest";
import { parsePresentationWorkbenchCommand } from "./presentationWorkbenchCommand";

describe("parsePresentationWorkbenchCommand", () => {
  it("应解析带类型、风格、受众和页数的 @PPT 命令", () => {
    const result = parsePresentationWorkbenchCommand(
      "@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
    );

    expect(result).toMatchObject({
      trigger: "@PPT",
      deckType: "pitch_deck",
      style: "极简科技",
      audience: "投资人",
      slideCount: 10,
      prompt: "帮我做一个 AI 助手创业项目融资演示稿",
    });
  });

  it("应兼容 @slides 英文触发", () => {
    const result = parsePresentationWorkbenchCommand(
      "@slides pitch deck for an AI note startup audience: seed investors",
    );

    expect(result).toMatchObject({
      trigger: "@slides",
      deckType: "pitch_deck",
      prompt: "for an AI note startup audience: seed investors",
    });
  });

  it("没有显式字段时也应保留演示稿生成意图", () => {
    const result = parsePresentationWorkbenchCommand(
      "@演示 帮我整理一份面向内部复盘会的项目汇报稿",
    );

    expect(result).toMatchObject({
      trigger: "@演示",
      deckType: undefined,
      prompt: "帮我整理一份面向内部复盘会的项目汇报稿",
    });
  });

  it("非演示命令应返回空", () => {
    expect(parsePresentationWorkbenchCommand("@网页 帮我做个官网")).toBeNull();
  });
});
