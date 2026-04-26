import { describe, expect, it } from "vitest";
import { parseTranslationWorkbenchCommand } from "./translationWorkbenchCommand";

describe("parseTranslationWorkbenchCommand", () => {
  it("应解析带显式字段的 @翻译 命令", () => {
    const result = parseTranslationWorkbenchCommand(
      "@翻译 内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
    );

    expect(result).toMatchObject({
      trigger: "@翻译",
      content: "hello world",
      sourceLanguage: "英语",
      targetLanguage: "中文",
      style: "产品文案",
      outputFormat: "只输出译文",
      prompt: "hello world 从英语 译为中文 产品文案 只输出译文",
    });
  });

  it("应兼容自然语句输入", () => {
    const result = parseTranslationWorkbenchCommand(
      "@翻译 把这段话翻译成英文，保留专业语气",
    );

    expect(result).toMatchObject({
      trigger: "@翻译",
      prompt: "把这段话翻译成英文，保留专业语气",
    });
  });

  it("应兼容英文触发词与语言别名", () => {
    const result = parseTranslationWorkbenchCommand(
      "@translate content: 你好世界 target: english source: chinese style: concise",
    );

    expect(result).toMatchObject({
      trigger: "@translate",
      content: "你好世界",
      targetLanguage: "英语",
      sourceLanguage: "中文",
      style: "concise",
    });
  });

  it("应兼容 Ribbi 风格的 @Write Translate 命令", () => {
    const result = parseTranslationWorkbenchCommand(
      "@Write Translate 把这段产品说明译成英文，保留品牌语气",
    );

    expect(result).toMatchObject({
      trigger: "@Write Translate",
      prompt: "把这段产品说明译成英文，保留品牌语气",
    });
  });

  it("非翻译命令应返回空", () => {
    expect(parseTranslationWorkbenchCommand("@总结 你好世界")).toBeNull();
  });
});
