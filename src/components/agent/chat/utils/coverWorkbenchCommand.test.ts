import { describe, expect, it } from "vitest";
import { parseCoverWorkbenchCommand } from "./coverWorkbenchCommand";

describe("parseCoverWorkbenchCommand", () => {
  it("应解析带平台、标题、风格和尺寸的 @封面 命令", () => {
    const result = parseCoverWorkbenchCommand(
      "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
    );

    expect(result).toMatchObject({
      trigger: "@封面",
      title: "春日咖啡快闪",
      platform: "小红书",
      style: "清新插画",
      size: "1:1",
      prompt: "春日咖啡市集封面",
    });
  });

  it("应解析带显式平台字段的 @cover 命令", () => {
    const result = parseCoverWorkbenchCommand(
      "@cover platform: YouTube style: 极简科技风 1280x720 做一期 AI Agent 观察封面",
    );

    expect(result).toMatchObject({
      trigger: "@cover",
      platform: "YouTube",
      style: "极简科技风",
      size: "1280x720",
      prompt: "一期 AI Agent 观察封面",
    });
  });

  it("非封面命令应返回空", () => {
    expect(parseCoverWorkbenchCommand("@视频 产品发布片")).toBeNull();
  });
});
