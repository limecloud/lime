import { describe, expect, it } from "vitest";
import { parseResourceSearchWorkbenchCommand } from "./resourceSearchWorkbenchCommand";

describe("parseResourceSearchWorkbenchCommand", () => {
  it("应解析带显式字段的 @素材 命令", () => {
    const result = parseResourceSearchWorkbenchCommand(
      "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
    );

    expect(result).toMatchObject({
      trigger: "@素材",
      resourceType: "image",
      query: "咖啡馆木桌背景",
      usage: "公众号头图",
      count: 8,
      prompt: "咖啡馆木桌背景 公众号头图",
    });
  });

  it("应解析自然语句里的资源类型、用途和数量", () => {
    const result = parseResourceSearchWorkbenchCommand(
      "@素材 BGM 科技感新品发布背景音乐 用于开场视频 5首",
    );

    expect(result).toMatchObject({
      trigger: "@素材",
      resourceType: "bgm",
      query: "科技感新品发布背景音乐",
      usage: "开场视频",
      count: 5,
      prompt: "科技感新品发布背景音乐",
    });
  });

  it("应兼容 @resource 英文触发", () => {
    const result = parseResourceSearchWorkbenchCommand(
      "@resource image query: cozy coffee shop background usage: hero banner count: 6",
    );

    expect(result).toMatchObject({
      trigger: "@resource",
      resourceType: "image",
      query: "cozy coffee shop background",
      usage: "hero banner",
      count: 6,
      prompt: "cozy coffee shop background hero banner",
    });
  });

  it("非素材命令应返回空", () => {
    expect(
      parseResourceSearchWorkbenchCommand("@视频 做一条新品视频"),
    ).toBeNull();
  });
});
