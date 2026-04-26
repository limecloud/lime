import { describe, expect, it } from "vitest";

import { parseVoiceWorkbenchCommand } from "./voiceWorkbenchCommand";

describe("parseVoiceWorkbenchCommand", () => {
  it("应解析带语言与风格字段的 @配音 命令", () => {
    const result = parseVoiceWorkbenchCommand(
      "@配音 目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿",
    );

    expect(result).toMatchObject({
      trigger: "@配音",
      body: "目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿",
      prompt: "给这个新品视频做一版发布配音稿",
      targetLanguage: "英文",
      voiceStyle: "科技感",
    });
  });

  it("应解析英文别名 @voice", () => {
    const result = parseVoiceWorkbenchCommand(
      "@voice 为这条视频整理一版日文配音需求",
    );

    expect(result).toMatchObject({
      trigger: "@voice",
      body: "为这条视频整理一版日文配音需求",
      prompt: "为这条视频整理一版日文配音需求",
    });
  });

  it("应兼容 Ribbi 风格的 @Website Voiceover 命令", () => {
    const result = parseVoiceWorkbenchCommand(
      "@Website Voiceover 语言: 英文 风格: 纪录片 给这个产品页做配音稿",
    );

    expect(result).toMatchObject({
      trigger: "@Website Voiceover",
      targetLanguage: "英文",
      voiceStyle: "纪录片",
      prompt: "给这个产品页做配音稿",
    });
  });

  it("无正文时仍应返回空 prompt，交给后续链路兜底", () => {
    const result = parseVoiceWorkbenchCommand("@配音");

    expect(result).toMatchObject({
      trigger: "@配音",
      body: "",
      prompt: "",
    });
  });

  it("不应误识别其它命令", () => {
    expect(parseVoiceWorkbenchCommand("@视频 做一条新品视频")).toBeNull();
  });
});
