import { describe, expect, it } from "vitest";
import { parseGrowthWorkbenchCommand } from "./growthWorkbenchCommand";

describe("parseGrowthWorkbenchCommand", () => {
  it("应解析带平台、账号、频率和告警的 @增长 命令", () => {
    const result = parseGrowthWorkbenchCommand(
      "@增长 平台:X 账号:@openai,@anthropic 回报频率:每天 09:00 告警阈值:互动率低于 2% 帮我先做一版增长跟踪策略",
    );

    expect(result).toMatchObject({
      trigger: "@增长",
      platformType: "x",
      platformLabel: "X / Twitter",
      accountList: "@openai, @anthropic",
      reportCadence: "每天 09:00",
      alertThreshold: "互动率低于 2%",
      prompt: "帮我先做一版增长跟踪策略",
    });
  });

  it("应兼容 @Growth Expert 英文触发词", () => {
    const result = parseGrowthWorkbenchCommand(
      "@Growth Expert platform: TikTok accounts: @capcut, @notion cadence: every day 08:00 alert: engagement down 20% help me track short video hooks",
    );

    expect(result).toMatchObject({
      trigger: "@Growth Expert",
      platformType: "tiktok",
      platformLabel: "TikTok",
      accountList: "@capcut, @notion",
      reportCadence: "every day 08:00",
      alertThreshold: "engagement down 20%",
      prompt: "help me track short video hooks",
    });
  });

  it("未写显式账号字段时应尽量从 handle 推断账号列表", () => {
    const result = parseGrowthWorkbenchCommand(
      "@增长跟踪 X @openai @anthropic 请持续跟踪内容增长节奏",
    );

    expect(result).toMatchObject({
      trigger: "@增长跟踪",
      platformType: "x",
      accountList: "@openai, @anthropic",
      prompt: "@openai @anthropic 请持续跟踪内容增长节奏",
    });
  });

  it("非增长命令应返回空", () => {
    expect(parseGrowthWorkbenchCommand("@搜索 OpenAI 最新融资")).toBeNull();
  });
});
