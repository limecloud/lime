import { describe, expect, it } from "vitest";

import { detectBrowserTaskRequirement } from "./browserTaskRequirement";

describe("browserTaskRequirement", () => {
  it("发布微信公众号文章应识别为必须浏览器且需要用户步骤", () => {
    expect(
      detectBrowserTaskRequirement("帮我把这篇文章发布到微信公众号后台"),
    ).toMatchObject({
      requirement: "required_with_user_step",
      launchUrl: "https://mp.weixin.qq.com/",
      platformLabel: "微信公众号后台",
    });
  });

  it("后台表单提交任务应识别为必须浏览器", () => {
    expect(
      detectBrowserTaskRequirement("登录后台填写表单并提交线索"),
    ).toMatchObject({
      requirement: "required_with_user_step",
    });
  });

  it("普通网页浏览与阅读不应误判为必须浏览器任务", () => {
    expect(
      detectBrowserTaskRequirement("打开京东商品页看看今天的价格"),
    ).toBeNull();
  });

  it("发布验收与控制台检查不应误判为网页后台任务", () => {
    expect(
      detectBrowserTaskRequirement(
        "请生成发布验收摘要，包含慢输入压力、发送到对话页链路和控制台检查。",
      ),
    ).toBeNull();
  });

  it("X / Twitter 发布任务也应识别为必须浏览器且需要用户步骤", () => {
    expect(
      detectBrowserTaskRequirement(
        "平台:X / Twitter 帮我整理成可直接发布的版本",
      ),
    ).toMatchObject({
      requirement: "required_with_user_step",
      launchUrl: "https://x.com/compose/post",
      platformLabel: "X / Twitter",
    });
  });
});
