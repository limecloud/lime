import { describe, expect, it } from "vitest";
import {
  formatTranscriptSegmentRange,
  parseTranscriptContent,
} from "./transcriptSegments";

describe("transcriptSegments", () => {
  it("应从 verbose JSON transcript 中解析时间轴和说话人", () => {
    const parsed = parseTranscriptContent(
      JSON.stringify({
        text: "主持人：欢迎来到 Lime。\n嘉宾：我们聊多模态运行合同。",
        segments: [
          {
            start: 0,
            end: 2.4,
            speaker: "host",
            text: "欢迎来到 Lime。",
          },
          {
            start: 2.4,
            end: 5.8,
            speaker: "speaker_2",
            text: "我们聊多模态运行合同。",
          },
        ],
      }),
    );

    expect(parsed.text).toBe(
      "主持人：欢迎来到 Lime。\n嘉宾：我们聊多模态运行合同。",
    );
    expect(parsed.segments).toMatchObject([
      {
        index: 1,
        startMs: 0,
        endMs: 2400,
        speaker: "host",
        text: "欢迎来到 Lime。",
      },
      {
        index: 2,
        startMs: 2400,
        endMs: 5800,
        speaker: "说话人 2",
        text: "我们聊多模态运行合同。",
      },
    ]);
    expect(formatTranscriptSegmentRange(parsed.segments[1])).toBe(
      "00:02 - 00:05",
    );
  });

  it("应从 VTT/SRT 内容中恢复逐段时间轴", () => {
    const parsed = parseTranscriptContent(`WEBVTT

00:00:01.000 --> 00:00:03.500
<v 主持人>欢迎来到 Lime 访谈。</v>

00:00:04,000 --> 00:00:06,000
嘉宾: 这次我们讲转写 viewer。
`);

    expect(parsed.segments).toMatchObject([
      {
        index: 1,
        startMs: 1000,
        endMs: 3500,
        speaker: "主持人",
        text: "欢迎来到 Lime 访谈。",
      },
      {
        index: 2,
        startMs: 4000,
        endMs: 6000,
        speaker: "嘉宾",
        text: "这次我们讲转写 viewer。",
      },
    ]);
  });
});
