import { describe, expect, it } from "vitest";
import { parseTranscriptionWorkbenchCommand } from "./transcriptionWorkbenchCommand";

describe("parseTranscriptionWorkbenchCommand", () => {
  it("应解析带 URL 的 @转写 命令", () => {
    const result = parseTranscriptionWorkbenchCommand(
      "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt 带时间戳 区分说话人 语言 zh",
    );

    expect(result).toMatchObject({
      trigger: "@转写",
      sourceUrl: "https://example.com/interview.mp4",
      prompt: "逐字稿",
      outputFormat: "srt",
      timestamps: true,
      speakerLabels: true,
      language: "zh",
    });
  });

  it("应解析带本地路径的 @transcribe 命令", () => {
    const result = parseTranscriptionWorkbenchCommand(
      '@transcribe "/tmp/interview.wav" 导出 markdown 不要时间戳',
    );

    expect(result).toMatchObject({
      trigger: "@transcribe",
      sourcePath: "/tmp/interview.wav",
      outputFormat: "markdown",
      timestamps: false,
    });
  });

  it("应兼容 Ribbi 风格的 @Audio Extractor 命令", () => {
    const result = parseTranscriptionWorkbenchCommand(
      "@Audio Extractor https://example.com/demo.mp4 export markdown",
    );

    expect(result).toMatchObject({
      trigger: "@Audio Extractor",
      sourceUrl: "https://example.com/demo.mp4",
      outputFormat: "markdown",
    });
  });

  it("缺少来源时也应保留转写意图，交给 Agent 继续追问", () => {
    const result =
      parseTranscriptionWorkbenchCommand("@转写 帮我整理成会议纪要");

    expect(result).toMatchObject({
      trigger: "@转写",
      prompt: "帮我整理成会议纪要",
      sourceUrl: undefined,
      sourcePath: undefined,
    });
  });

  it("非转写命令应返回空", () => {
    expect(parseTranscriptionWorkbenchCommand("@视频 产品发布片")).toBeNull();
  });
});
