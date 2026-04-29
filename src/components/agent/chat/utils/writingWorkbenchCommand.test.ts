import { describe, expect, it } from "vitest";
import { parseWritingWorkbenchCommand } from "./writingWorkbenchCommand";

describe("parseWritingWorkbenchCommand", () => {
  it("应解析带平台的 @写作 命令", () => {
    const result = parseWritingWorkbenchCommand(
      "@写作 平台:微信公众号后台 帮我把这份活动素材整理成一版主稿",
    );

    expect(result).toMatchObject({
      trigger: "@写作",
      platformType: "wechat_official_account",
      platformLabel: "微信公众号后台",
      draftKind: "general",
      prompt: "帮我把这份活动素材整理成一版主稿",
    });
    expect(result?.dispatchBody).toContain("写作主稿");
  });

  it("应兼容 @Writing Partner 并继续走通用写作主稿语义", () => {
    const result = parseWritingWorkbenchCommand(
      "@Writing Partner help me turn this launch brief into a stronger narrative",
    );

    expect(result).toMatchObject({
      trigger: "@Writing Partner",
      draftKind: "general",
      prompt: "help me turn this launch brief into a stronger narrative",
    });
    expect(result?.dispatchBody).toContain("写作主稿");
  });

  it("应把 @Blog 1 默认归一到 blog 草稿", () => {
    const result = parseWritingWorkbenchCommand(
      "@Blog 1 帮我写一篇 AI 浏览器产品观察文章",
    );

    expect(result).toMatchObject({
      trigger: "@Blog 1",
      draftKind: "blog",
      prompt: "帮我写一篇 AI 浏览器产品观察文章",
    });
    expect(result?.dispatchBody).toContain("Blog 文章主稿");
  });

  it("应把 @Newsletters Pro 默认归一到 newsletter 草稿", () => {
    const result = parseWritingWorkbenchCommand(
      "@Newsletters Pro summarize this week’s AI agent launches into a concise newsletter",
    );

    expect(result).toMatchObject({
      trigger: "@Newsletters Pro",
      draftKind: "newsletter",
      prompt:
        "summarize this week’s AI agent launches into a concise newsletter",
    });
    expect(result?.dispatchBody).toContain("Newsletter / 简报主稿");
  });

  it("应兼容 @Web Copy 并继续走通用写作主稿语义", () => {
    const result = parseWritingWorkbenchCommand(
      "@Web Copy rewrite this SaaS homepage headline and CTA",
    );

    expect(result).toMatchObject({
      trigger: "@Web Copy",
      draftKind: "general",
      prompt: "rewrite this SaaS homepage headline and CTA",
    });
    expect(result?.dispatchBody).toContain("写作主稿");
  });

  it("非写作命令应返回空", () => {
    expect(parseWritingWorkbenchCommand("@发布 帮我发到公众号")).toBeNull();
  });
});
