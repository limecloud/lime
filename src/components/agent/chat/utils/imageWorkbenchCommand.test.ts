import { describe, expect, it } from "vitest";
import {
  buildImageGenerateSkillSlashCommand,
  parseImageWorkbenchCommand,
  shouldRouteImageWorkbenchCommandToSkill,
} from "./imageWorkbenchCommand";

describe("parseImageWorkbenchCommand", () => {
  it("应解析生成命令的数量与比例", () => {
    const result = parseImageWorkbenchCommand(
      "@配图 生成 公众号头图，科技感，16:9，出 4 张",
    );

    expect(result).toMatchObject({
      trigger: "@配图",
      mode: "generate",
      count: 4,
      aspectRatio: "16:9",
      size: "1792x1024",
      prompt: "公众号头图，科技感",
    });
  });

  it("应解析编辑命令的目标图引用", () => {
    const result = parseImageWorkbenchCommand(
      "@image 编辑 #img-2 去掉文字，保留主体",
    );

    expect(result).toMatchObject({
      trigger: "@image",
      mode: "edit",
      targetRef: "img-2",
      prompt: "去掉文字，保留主体",
    });
  });

  it("应把 @修图 默认解析为编辑命令", () => {
    const result = parseImageWorkbenchCommand(
      "@修图 #img-2 去掉角标，保留主体",
    );

    expect(result).toMatchObject({
      trigger: "@修图",
      mode: "edit",
      targetRef: "img-2",
      prompt: "去掉角标，保留主体",
    });
  });

  it("应把 @重绘 默认解析为重绘命令", () => {
    const result = parseImageWorkbenchCommand("@重绘 #img-7 更偏插画风，4:5");

    expect(result).toMatchObject({
      trigger: "@重绘",
      mode: "variation",
      targetRef: "img-7",
      aspectRatio: "4:5",
      size: "864x1152",
      prompt: "更偏插画风",
    });
  });

  it("未显式声明动作但带目标图时应默认为变体", () => {
    const result = parseImageWorkbenchCommand("/image #img-7 更偏插画风，4:5");

    expect(result).toMatchObject({
      trigger: "/image",
      mode: "variation",
      targetRef: "img-7",
      aspectRatio: "4:5",
      size: "864x1152",
      prompt: "更偏插画风",
    });
  });

  it("非图片命令应返回空", () => {
    expect(parseImageWorkbenchCommand("帮我总结一下这段代码")).toBeNull();
  });

  it("纯文本生成命令应路由到 image_generate skill", () => {
    const parsed = parseImageWorkbenchCommand(
      "@配图 生成 公众号头图，科技感，16:9，出 4 张",
    );

    expect(parsed).not.toBeNull();
    expect(
      shouldRouteImageWorkbenchCommandToSkill({
        parsedCommand: parsed!,
      }),
    ).toBe(true);
    expect(buildImageGenerateSkillSlashCommand(parsed!)).toBe(
      "/image_generate 生成 公众号头图，科技感，16:9，出 4 张",
    );
  });

  it("带引用图的编辑命令不应直接路由到 skill", () => {
    const parsed = parseImageWorkbenchCommand(
      "@image 编辑 #img-2 去掉文字，保留主体",
    );

    expect(parsed).not.toBeNull();
    expect(
      shouldRouteImageWorkbenchCommandToSkill({
        parsedCommand: parsed!,
      }),
    ).toBe(false);
  });

  it("@修图 不应被路由到 image_generate skill", () => {
    const parsed = parseImageWorkbenchCommand(
      "@修图 #img-2 提亮肤色并保留主体",
    );

    expect(parsed).not.toBeNull();
    expect(
      shouldRouteImageWorkbenchCommandToSkill({
        parsedCommand: parsed!,
      }),
    ).toBe(false);
  });

  it("@修图 转发到 slash skill 时应补齐编辑语义", () => {
    const parsed = parseImageWorkbenchCommand(
      "@修图 #img-2 提亮肤色并保留主体",
    );

    expect(parsed).not.toBeNull();
    expect(buildImageGenerateSkillSlashCommand(parsed!)).toBe(
      "/image_generate 编辑 #img-2 提亮肤色并保留主体",
    );
  });

  it("@重绘 不应被路由到 image_generate skill，并应补齐重绘语义", () => {
    const parsed = parseImageWorkbenchCommand("@重绘 #img-7 更偏插画风");

    expect(parsed).not.toBeNull();
    expect(
      shouldRouteImageWorkbenchCommandToSkill({
        parsedCommand: parsed!,
      }),
    ).toBe(false);
    expect(buildImageGenerateSkillSlashCommand(parsed!)).toBe(
      "/image_generate 重绘 #img-7 更偏插画风",
    );
  });
});
