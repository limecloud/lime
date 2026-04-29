import { describe, expect, it } from "vitest";
import { parseComplianceWorkbenchCommand } from "./complianceWorkbenchCommand";

describe("parseComplianceWorkbenchCommand", () => {
  it("应解析带显式字段的 @发布合规 命令，并补齐默认合规语义", () => {
    const result = parseComplianceWorkbenchCommand(
      "@发布合规 内容:这是一篇小红书种草文案 重点:夸大宣传 输出:风险清单",
    );

    expect(result).toMatchObject({
      trigger: "@发布合规",
      prompt: "这是一篇小红书种草文案 围绕夸大宣传 风险清单",
      content: "这是一篇小红书种草文案",
      focus: "夸大宣传",
      style: "合规审校",
      outputFormat: "风险清单",
    });
  });

  it("未显式填写字段时应补齐默认 focus、style 和 outputFormat", () => {
    const result = parseComplianceWorkbenchCommand(
      "@合规 帮我看看这篇公众号文案有没有广告法和版权风险",
    );

    expect(result).toMatchObject({
      trigger: "@合规",
      prompt: "帮我看看这篇公众号文案有没有广告法和版权风险",
      focus: "广告法、版权、平台发布风险",
      style: "合规审校",
      outputFormat: "风险等级、风险点、修改建议、待确认项",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseComplianceWorkbenchCommand(
      "@compliance check whether this ad copy has policy or copyright risks",
    );

    expect(result).toMatchObject({
      trigger: "@compliance",
      prompt: "check whether this ad copy has policy or copyright risks",
    });
  });

  it("非发布合规命令应返回空", () => {
    expect(
      parseComplianceWorkbenchCommand("@分析 帮我分析这篇文案"),
    ).toBeNull();
  });
});
