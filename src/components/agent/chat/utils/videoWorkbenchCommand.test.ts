import { describe, expect, it } from "vitest";
import { parseVideoWorkbenchCommand } from "./videoWorkbenchCommand";

describe("parseVideoWorkbenchCommand", () => {
  it("应解析 @视频 的提示词、时长、画幅与清晰度", () => {
    const result = parseVideoWorkbenchCommand(
      "@视频 15秒 新品发布短视频，16:9，720p",
    );

    expect(result).toMatchObject({
      trigger: "@视频",
      prompt: "新品发布短视频",
      duration: 15,
      aspectRatio: "16:9",
      resolution: "720p",
    });
  });

  it("应兼容 @video 英文触发", () => {
    const result = parseVideoWorkbenchCommand(
      "@video generate 9s product teaser, 9:16, 1080p",
    );

    expect(result).toMatchObject({
      trigger: "@video",
      prompt: "product teaser",
      duration: 9,
      aspectRatio: "9:16",
      resolution: "1080p",
    });
  });

  it("非视频命令应返回空", () => {
    expect(parseVideoWorkbenchCommand("@配图 春日海报")).toBeNull();
  });
});
