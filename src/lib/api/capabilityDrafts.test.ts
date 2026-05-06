import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { capabilityDraftsApi } from "./capabilityDrafts";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("capabilityDraftsApi", () => {
  beforeEach(() => {
    vi.mocked(safeInvoke).mockReset();
  });

  it("创建草案时应通过单一命令网关提交嵌套 request 并归一化返回", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      draft_id: "capdraft-1",
      name: "竞品监控草案",
      description: "每天采集竞品变化。",
      user_goal: "持续监控爆款。",
      source_kind: "manual",
      source_refs: [" docs/research/creaoai "],
      permission_summary: ["Level 0 只读发现"],
      generated_files: [
        {
          relative_path: "SKILL.md",
          byte_length: 16,
          sha256: "abc",
        },
      ],
      verification_status: "unverified",
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
      draft_root: "/tmp/work/.lime/capability-drafts/capdraft-1",
      manifest_path:
        "/tmp/work/.lime/capability-drafts/capdraft-1/manifest.json",
    });

    await expect(
      capabilityDraftsApi.create({
        workspaceRoot: "/tmp/work",
        name: "竞品监控草案",
        description: "每天采集竞品变化。",
        userGoal: "持续监控爆款。",
        sourceKind: "manual",
        sourceRefs: ["docs/research/creaoai"],
        permissionSummary: ["Level 0 只读发现"],
        generatedFiles: [
          {
            relativePath: "SKILL.md",
            content: "# 竞品监控草案",
          },
        ],
      }),
    ).resolves.toMatchObject({
      draftId: "capdraft-1",
      userGoal: "持续监控爆款。",
      sourceRefs: ["docs/research/creaoai"],
      generatedFiles: [
        {
          relativePath: "SKILL.md",
          byteLength: 16,
          sha256: "abc",
        },
      ],
      verificationStatus: "unverified",
    });

    expect(safeInvoke).toHaveBeenCalledWith("capability_draft_create", {
      request: expect.objectContaining({
        workspaceRoot: "/tmp/work",
        generatedFiles: [
          {
            relativePath: "SKILL.md",
            content: "# 竞品监控草案",
          },
        ],
      }),
    });
  });

  it("列表接口应防御非数组返回，并归一化 camelCase 返回", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ not: "array" });
    await expect(
      capabilityDraftsApi.list({ workspaceRoot: "/tmp/work" }),
    ).resolves.toEqual([]);

    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        draftId: "capdraft-2",
        name: "只读 CLI 草案",
        description: "整理 CLI 输出。",
        userGoal: "把 CLI 编排成未验证能力草案。",
        sourceKind: "cli",
        sourceRefs: [],
        permissionSummary: [],
        generatedFiles: [],
        verificationStatus: "failed_self_check",
        lastVerification: {
          reportId: "capver-2",
          status: "failed",
          summary: "自检未通过。",
          checkedAt: "2026-05-05T00:00:00.000Z",
          failedCheckCount: 1,
        },
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-2",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-2/manifest.json",
      },
    ]);

    await expect(
      capabilityDraftsApi.list({ workspaceRoot: "/tmp/work" }),
    ).resolves.toEqual([
      expect.objectContaining({
        draftId: "capdraft-2",
        sourceKind: "cli",
        verificationStatus: "failed_self_check",
        lastVerification: expect.objectContaining({
          failedCheckCount: 1,
        }),
      }),
    ]);
  });

  it("获取单个草案时应允许返回 null", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(null);

    await expect(
      capabilityDraftsApi.get({
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-missing",
      }),
    ).resolves.toBeNull();

    expect(safeInvoke).toHaveBeenCalledWith("capability_draft_get", {
      request: {
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-missing",
      },
    });
  });

  it("验证草案时应归一化 report 与刷新后的 draft", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      draft: {
        draft_id: "capdraft-verified",
        name: "只读 CLI 草案",
        description: "整理 CLI 输出。",
        user_goal: "生成报告。",
        source_kind: "cli",
        source_refs: ["trendctl --help"],
        permission_summary: ["Level 0 只读发现"],
        generated_files: [
          {
            relative_path: "SKILL.md",
            byte_length: 128,
            sha256: "abc",
          },
        ],
        verification_status: "verified_pending_registration",
        last_verification: {
          report_id: "capver-1",
          status: "passed",
          summary: "最小 verification gate 通过。",
          checked_at: "2026-05-05T01:00:00.000Z",
          failed_check_count: 0,
        },
        last_registration: {
          registration_id: "capreg-1",
          registered_at: "2026-05-05T01:10:00.000Z",
          skill_directory: "capability-readonly",
          registered_skill_directory: "/tmp/work/.agents/skills/capability-readonly",
          source_draft_id: "capdraft-verified",
          source_verification_report_id: "capver-1",
          generated_file_count: 4,
          permission_summary: ["Level 0 只读发现"],
        },
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T01:00:00.000Z",
        draft_root: "/tmp/work/.lime/capability-drafts/capdraft-verified",
        manifest_path:
          "/tmp/work/.lime/capability-drafts/capdraft-verified/manifest.json",
      },
      report: {
        report_id: "capver-1",
        draft_id: "capdraft-verified",
        status: "passed",
        summary: "最小 verification gate 通过。",
        checked_at: "2026-05-05T01:00:00.000Z",
        failed_check_count: 0,
        checks: [
          {
            id: "package_structure",
            label: "包结构",
            status: "passed",
            message: "通过",
            suggestions: [],
            can_agent_repair: false,
          },
        ],
      },
    });

    await expect(
      capabilityDraftsApi.verify({
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-verified",
      }),
    ).resolves.toMatchObject({
      draft: {
        draftId: "capdraft-verified",
        verificationStatus: "verified_pending_registration",
        lastVerification: {
          reportId: "capver-1",
          status: "passed",
          failedCheckCount: 0,
        },
        lastRegistration: {
          registrationId: "capreg-1",
          skillDirectory: "capability-readonly",
          sourceVerificationReportId: "capver-1",
        },
      },
      report: {
        draftId: "capdraft-verified",
        reportId: "capver-1",
        checks: [
          {
            id: "package_structure",
            canAgentRepair: false,
          },
        ],
      },
    });

    expect(safeInvoke).toHaveBeenCalledWith("capability_draft_verify", {
      request: {
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-verified",
      },
    });
  });

  it("注册草案时应归一化注册摘要与刷新后的 draft", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      draft: {
        draft_id: "capdraft-registered",
        name: "只读 CLI 草案",
        description: "整理 CLI 输出。",
        user_goal: "生成报告。",
        source_kind: "cli",
        source_refs: ["trendctl --help"],
        permission_summary: ["Level 0 只读发现"],
        generated_files: [
          {
            relative_path: "SKILL.md",
            byte_length: 128,
            sha256: "abc",
          },
        ],
        verification_status: "registered",
        last_verification: {
          report_id: "capver-1",
          status: "passed",
          summary: "最小 verification gate 通过。",
          checked_at: "2026-05-05T01:00:00.000Z",
          failed_check_count: 0,
        },
        last_registration: {
          registration_id: "capreg-1",
          registered_at: "2026-05-05T01:10:00.000Z",
          skill_directory: "capability-registered",
          registered_skill_directory:
            "/tmp/work/.agents/skills/capability-registered",
          source_draft_id: "capdraft-registered",
          source_verification_report_id: "capver-1",
          generated_file_count: 4,
          permission_summary: ["Level 0 只读发现"],
        },
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T01:10:00.000Z",
        draft_root: "/tmp/work/.lime/capability-drafts/capdraft-registered",
        manifest_path:
          "/tmp/work/.lime/capability-drafts/capdraft-registered/manifest.json",
      },
      registration: {
        registration_id: "capreg-1",
        registered_at: "2026-05-05T01:10:00.000Z",
        skill_directory: "capability-registered",
        registered_skill_directory:
          "/tmp/work/.agents/skills/capability-registered",
        source_draft_id: "capdraft-registered",
        source_verification_report_id: "capver-1",
        generated_file_count: 4,
        permission_summary: ["Level 0 只读发现"],
      },
    });

    await expect(
      capabilityDraftsApi.register({
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-registered",
      }),
    ).resolves.toMatchObject({
      draft: {
        draftId: "capdraft-registered",
        verificationStatus: "registered",
        lastRegistration: {
          registrationId: "capreg-1",
          skillDirectory: "capability-registered",
          sourceVerificationReportId: "capver-1",
        },
      },
      registration: {
        registrationId: "capreg-1",
        registeredSkillDirectory:
          "/tmp/work/.agents/skills/capability-registered",
        generatedFileCount: 4,
      },
    });

    expect(safeInvoke).toHaveBeenCalledWith("capability_draft_register", {
      request: {
        workspaceRoot: "/tmp/work",
        draftId: "capdraft-registered",
      },
    });
  });

  it("读取 Workspace 已注册能力时应归一化 provenance、标准状态与 runtime gate", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        key: "workspace:capability-report",
        name: "只读 CLI 报告",
        description: "把本地只读 CLI 输出整理成 Markdown 报告。",
        directory: "capability-report",
        registered_skill_directory: "/tmp/work/.agents/skills/capability-report",
        registration: {
          registration_id: "capreg-1",
          registered_at: "2026-05-05T01:10:00.000Z",
          skill_directory: "capability-report",
          registered_skill_directory:
            "/tmp/work/.agents/skills/capability-report",
          source_draft_id: "capdraft-registered",
          source_verification_report_id: "capver-1",
          generated_file_count: 4,
          permission_summary: ["Level 0 只读发现"],
        },
        permission_summary: ["Level 0 只读发现"],
        metadata: {
          lime_workflow_ref: "references/workflow.yaml",
        },
        allowed_tools: ["Read"],
        resource_summary: {
          has_scripts: true,
          has_references: true,
          has_assets: false,
        },
        standard_compliance: {
          is_standard: true,
          validation_errors: [],
          deprecated_fields: [],
        },
        launch_enabled: false,
        runtime_gate: "进入运行前还需要 P3C runtime binding。",
      },
    ]);

    await expect(
      capabilityDraftsApi.listRegisteredSkills({
        workspaceRoot: "/tmp/work",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        key: "workspace:capability-report",
        registeredSkillDirectory:
          "/tmp/work/.agents/skills/capability-report",
        registration: expect.objectContaining({
          registrationId: "capreg-1",
          sourceDraftId: "capdraft-registered",
          sourceVerificationReportId: "capver-1",
        }),
        metadata: {
          lime_workflow_ref: "references/workflow.yaml",
        },
        allowedTools: ["Read"],
        resourceSummary: {
          hasScripts: true,
          hasReferences: true,
          hasAssets: false,
        },
        standardCompliance: {
          isStandard: true,
          validationErrors: [],
          deprecatedFields: [],
        },
        launchEnabled: false,
        runtimeGate: "进入运行前还需要 P3C runtime binding。",
      }),
    ]);

    expect(safeInvoke).toHaveBeenCalledWith(
      "capability_draft_list_registered_skills",
      {
        request: {
          workspaceRoot: "/tmp/work",
        },
      },
    );
  });

  it("读取 Workspace 已注册能力时应防御非数组返回", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ not: "array" });

    await expect(
      capabilityDraftsApi.listRegisteredSkills({
        workspaceRoot: "/tmp/work",
      }),
    ).resolves.toEqual([]);
  });
});
