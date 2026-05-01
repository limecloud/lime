import { describe, expect, it } from "vitest";
import {
  getPcm16LeStats,
  isAudiblePcm16LeSegment,
  mergeLiveTranscript,
} from "./voiceLivePreview";

function pcm16Bytes(samples: number[]): number[] {
  return samples.flatMap((sample) => {
    const clamped = Math.max(-32768, Math.min(32767, sample));
    const unsigned = clamped < 0 ? clamped + 0x10000 : clamped;
    return [unsigned & 0xff, (unsigned >> 8) & 0xff];
  });
}

describe("voiceLivePreview", () => {
  it("应识别静音片段", () => {
    expect(isAudiblePcm16LeSegment(pcm16Bytes([0, 0, 0]))).toBe(false);
  });

  it("应识别有效语音片段", () => {
    expect(isAudiblePcm16LeSegment(pcm16Bytes([0, 1200, -1200]))).toBe(true);
  });

  it("应计算 PCM16LE 音频统计", () => {
    const stats = getPcm16LeStats(pcm16Bytes([0, 32767, -32768]));

    expect(stats.sampleCount).toBe(3);
    expect(stats.peak).toBeGreaterThan(0.99);
    expect(stats.rms).toBeGreaterThan(0.8);
  });

  it("应合并重叠实时识别文本", () => {
    expect(mergeLiveTranscript("你好世", "世界")).toBe("你好世界");
    expect(mergeLiveTranscript("hello", "world")).toBe("hello world");
  });
});
