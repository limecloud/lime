import { describe, expect, it } from "vitest";
import { parseUploadWorkbenchCommand } from "./uploadWorkbenchCommand";

describe("parseUploadWorkbenchCommand", () => {
  it("应解析带显式平台的 @上传 命令", () => {
    const result = parseUploadWorkbenchCommand(
      "@上传 平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
    );

    expect(result).toMatchObject({
      trigger: "@上传",
      platformType: "wechat_official_account",
      platformLabel: "微信公众号后台",
      prompt: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
    });
    expect(result?.dispatchBody).toContain("平台:微信公众号后台");
    expect(result?.dispatchBody).toContain("上传稿");
  });

  it("应兼容英文触发与英文平台名", () => {
    const result = parseUploadWorkbenchCommand(
      "@upload xiaohongshu prepare this launch draft for direct upload",
    );

    expect(result).toMatchObject({
      trigger: "@upload",
      platformType: "xiaohongshu",
      platformLabel: "小红书",
      prompt: "prepare this launch draft for direct upload",
    });
  });

  it("没有显式平台时也应保留上传意图", () => {
    const result = parseUploadWorkbenchCommand(
      "@上架 帮我整理一份可直接上传的内容版本和素材清单",
    );

    expect(result).toMatchObject({
      trigger: "@上架",
      platformType: undefined,
      prompt: "帮我整理一份可直接上传的内容版本和素材清单",
    });
    expect(result?.dispatchBody).toContain("上传稿");
  });

  it("非上传命令应返回空", () => {
    expect(parseUploadWorkbenchCommand("@发布 帮我发到公众号")).toBeNull();
  });
});
