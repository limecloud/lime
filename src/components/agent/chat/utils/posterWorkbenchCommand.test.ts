import { describe, expect, it } from "vitest";
import { parsePosterWorkbenchCommand } from "./posterWorkbenchCommand";

describe("parsePosterWorkbenchCommand", () => {
  it("应解析带平台、风格和默认海报尺寸的 @海报 命令", () => {
    const result = parsePosterWorkbenchCommand(
      "@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报",
    );

    expect(result).toMatchObject({
      trigger: "@海报",
      platform: "小红书",
      style: "清新拼贴",
      size: "864x1152",
      aspectRatio: "4:5",
      prompt: "适用于小红书，清新拼贴风格，海报设计，春日咖啡市集活动海报",
    });
  });

  it("应兼容显式尺寸与英文触发词", () => {
    const result = parsePosterWorkbenchCommand(
      "@poster platform: Instagram style: bold editorial 1080x1350 launch poster for AI hardware week",
    );

    expect(result).toMatchObject({
      trigger: "@poster",
      platform: "Instagram",
      style: "bold editorial",
      size: "1080x1350",
      prompt:
        "适用于Instagram，bold editorial风格，海报设计，launch poster for AI hardware week",
    });
  });

  it("非海报命令应返回空", () => {
    expect(parsePosterWorkbenchCommand("@配图 一张海边插画")).toBeNull();
  });
});
