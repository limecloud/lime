import { describe, expect, it } from "vitest";
import {
  canExecuteCapabilityDraft,
  canRegisterCapabilityDraft,
  canVerifyCapabilityDraft,
  getCapabilityDraftStatusPresentation,
  summarizeCapabilityDraftFailedChecks,
  summarizeCapabilityDraftFiles,
  summarizeCapabilityDraftPermissions,
  summarizeCapabilityDraftRegistration,
  summarizeCapabilityDraftVerification,
} from "./capabilityDraftPresentation";

describe("capabilityDraftPresentation", () => {
  it("未验证草案默认不允许执行或注册", () => {
    const draft = { verificationStatus: "unverified" as const };

    expect(canExecuteCapabilityDraft(draft)).toBe(false);
    expect(canRegisterCapabilityDraft(draft)).toBe(false);
    expect(canVerifyCapabilityDraft(draft)).toBe(true);
    expect(getCapabilityDraftStatusPresentation("unverified")).toMatchObject({
      label: "未验证",
      tone: "amber",
    });
  });

  it("应归纳权限与文件摘要", () => {
    expect(
      summarizeCapabilityDraftPermissions({ permissionSummary: [] }),
    ).toContain("默认停留在只读发现");
    expect(
      summarizeCapabilityDraftFiles({
        generatedFiles: [
          { relativePath: "SKILL.md", byteLength: 10, sha256: "a" },
          { relativePath: "scripts/run.ts", byteLength: 20, sha256: "b" },
          { relativePath: "examples/input.json", byteLength: 30, sha256: "c" },
          {
            relativePath: "tests/self-check.json",
            byteLength: 40,
            sha256: "d",
          },
        ],
      }),
    ).toBe("SKILL.md / scripts/run.ts / examples/input.json 等 4 个文件");
  });

  it("应展示验证通过与失败摘要，并允许进入注册但不允许执行", () => {
    const verifiedDraft = {
      verificationStatus: "verified_pending_registration" as const,
      lastVerification: {
        reportId: "capver-1",
        status: "passed" as const,
        summary: "最小 verification gate 通过，等待后续注册阶段。",
        checkedAt: "2026-05-05T00:00:00.000Z",
        failedCheckCount: 0,
      },
    };

    expect(
      getCapabilityDraftStatusPresentation("verification_failed"),
    ).toMatchObject({
      label: "验证未通过",
      tone: "rose",
    });
    expect(
      getCapabilityDraftStatusPresentation("verified_pending_registration"),
    ).toMatchObject({
      label: "验证通过，待注册",
      tone: "slate",
    });
    expect(canExecuteCapabilityDraft(verifiedDraft)).toBe(false);
    expect(canRegisterCapabilityDraft(verifiedDraft)).toBe(true);
    expect(summarizeCapabilityDraftVerification(verifiedDraft)).toContain(
      "等待后续注册阶段",
    );
    expect(
      summarizeCapabilityDraftFailedChecks({
        checks: [
          {
            id: "input_contract",
            label: "输入 contract",
            status: "failed",
            message: "缺少输入 contract。",
            suggestions: [],
            canAgentRepair: true,
          },
          {
            id: "output_contract",
            label: "输出 contract",
            status: "failed",
            message: "缺少输出 contract。",
            suggestions: [],
            canAgentRepair: true,
          },
        ],
      }),
    ).toBe("输入 contract / 输出 contract");
  });

  it("应展示注册状态和注册目录，但仍不允许执行", () => {
    const registeredDraft = {
      verificationStatus: "registered" as const,
      lastRegistration: {
        registrationId: "capreg-1",
        registeredAt: "2026-05-05T00:10:00.000Z",
        skillDirectory: "capability-readonly-report",
        registeredSkillDirectory:
          "/tmp/work/.agents/skills/capability-readonly-report",
        sourceDraftId: "capdraft-1",
        sourceVerificationReportId: "capver-1",
        generatedFileCount: 4,
        permissionSummary: ["Level 0 只读发现"],
      },
    };

    expect(getCapabilityDraftStatusPresentation("registered")).toMatchObject({
      label: "已注册",
      tone: "emerald",
    });
    expect(canExecuteCapabilityDraft(registeredDraft)).toBe(false);
    expect(canRegisterCapabilityDraft(registeredDraft)).toBe(false);
    expect(summarizeCapabilityDraftRegistration(registeredDraft)).toBe(
      "已注册目录：capability-readonly-report",
    );
  });
});
