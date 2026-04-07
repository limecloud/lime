import { describe, expect, it } from "vitest";
import { parseFormWorkbenchCommand } from "./formWorkbenchCommand";

describe("parseFormWorkbenchCommand", () => {
  it("应解析带类型、风格、受众和字段数的 @表单 命令", () => {
    const result = parseFormWorkbenchCommand(
      "@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
    );

    expect(result).toMatchObject({
      trigger: "@表单",
      formType: "registration_form",
      style: "简洁专业",
      audience: "活动嘉宾",
      fieldCount: 8,
      prompt: "帮我做一个 AI Workshop 报名表",
    });
  });

  it("应兼容 @form 英文触发", () => {
    const result = parseFormWorkbenchCommand(
      "@form survey form for beta users with product satisfaction and feature requests",
    );

    expect(result).toMatchObject({
      trigger: "@form",
      formType: "survey_form",
      prompt: "for beta users with product satisfaction and feature requests",
    });
  });

  it("没有显式字段时也应保留表单生成意图", () => {
    const result = parseFormWorkbenchCommand(
      "@问卷 帮我整理一个面向内部员工满意度调研的匿名问卷",
    );

    expect(result).toMatchObject({
      trigger: "@问卷",
      formType: undefined,
      prompt: "帮我整理一个面向内部员工满意度调研的匿名问卷",
    });
  });

  it("非表单命令应返回空", () => {
    expect(parseFormWorkbenchCommand("@网页 帮我做个官网")).toBeNull();
  });
});
