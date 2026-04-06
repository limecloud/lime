import { describe, expect, it } from "vitest";
import { parseTypesettingWorkbenchCommand } from "./typesettingWorkbenchCommand";

describe("parseTypesettingWorkbenchCommand", () => {
  it("应解析带平台约束的 @排版 命令", () => {
    const result = parseTypesettingWorkbenchCommand(
      "@排版 平台:小红书 帮我把下面文案整理成短句节奏",
    );

    expect(result).toMatchObject({
      trigger: "@排版",
      targetPlatform: "小红书",
      prompt: "帮我把下面文案整理成短句节奏",
    });
  });

  it("应兼容 @typesetting 英文触发", () => {
    const result = parseTypesettingWorkbenchCommand(
      "@typesetting YouTube format this script for spoken rhythm",
    );

    expect(result).toMatchObject({
      trigger: "@typesetting",
      targetPlatform: "YouTube",
      prompt: "this script for spoken rhythm",
    });
  });

  it("没有平台时也应保留排版意图", () => {
    const result = parseTypesettingWorkbenchCommand(
      "@排版 请帮我把下面内容整理成公众号排版风格",
    );

    expect(result).toMatchObject({
      trigger: "@排版",
      targetPlatform: undefined,
      prompt: "请帮我把下面内容整理成公众号排版风格",
    });
  });

  it("非排版命令应返回空", () => {
    expect(parseTypesettingWorkbenchCommand("@视频 做一条新品视频")).toBeNull();
  });
});
