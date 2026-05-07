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
      source_refs: [" docs/research/skill-forge "],
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
        sourceRefs: ["docs/research/skill-forge"],
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
      sourceRefs: ["docs/research/skill-forge"],
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
            id: "readonly_http_fixture_dry_run_execute",
            label: "只读 HTTP fixture dry-run 执行",
            status: "passed",
            message: "通过",
            suggestions: [],
            can_agent_repair: false,
            evidence: [
              { key: "scriptPath", value: "scripts/dry-run.mjs" },
              { key: "durationMs", value: "42" },
              { key: "", value: "drop-empty-key" },
            ],
          },
          {
            id: "readonly_http_execution_preflight",
            label: "只读 HTTP 执行 preflight",
            status: "passed",
            message: "已找到 execution_preflight。",
            suggestions: [],
            can_agent_repair: false,
            evidence: [
              { key: "preflightMode", value: "approval_request" },
              { key: "endpointSource", value: "runtime_input" },
              { key: "method", value: "GET" },
              {
                key: "credentialReferenceId",
                value: "readonly_api_session",
              },
              {
                key: "evidenceSchema",
                value:
                  "request_url_hash,request_method,response_status,response_sha256,executed_at",
              },
            ],
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
            id: "readonly_http_fixture_dry_run_execute",
            canAgentRepair: false,
            evidence: [
              { key: "scriptPath", value: "scripts/dry-run.mjs" },
              { key: "durationMs", value: "42" },
            ],
          },
          {
            id: "readonly_http_execution_preflight",
            canAgentRepair: false,
            evidence: [
              { key: "preflightMode", value: "approval_request" },
              { key: "endpointSource", value: "runtime_input" },
              { key: "method", value: "GET" },
              {
                key: "credentialReferenceId",
                value: "readonly_api_session",
              },
              {
                key: "evidenceSchema",
                value:
                  "request_url_hash,request_method,response_status,response_sha256,executed_at",
              },
            ],
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
          verification_gates: [
            {
              check_id: "readonly_http_execution_preflight",
              label: "只读 HTTP 执行 preflight",
              evidence: [
                { key: "method", value: "GET" },
                {
                  key: "credentialReferenceId",
                  value: "readonly_api_session",
                },
              ],
            },
          ],
          approval_requests: [
            {
              approval_id: "capreg-1:readonly-http-session",
              status: "pending",
              source_check_id: "readonly_http_execution_preflight",
              skill_directory: "capability-report",
              endpoint_source: "runtime_input",
              method: "GET",
              credential_reference_id: "readonly_api_session",
              evidence_schema: [
                "request_url_hash",
                "request_method",
                "response_status",
                "response_sha256",
                "executed_at",
              ],
              policy_path: "policy/readonly-http-session.json",
              created_at: "2026-05-05T01:10:00.000Z",
              consumption_gate: {
                status: "awaiting_session_approval",
                required_inputs: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference:readonly_api_session",
                  "evidence_capture",
                ],
                runtime_execution_enabled: false,
                credential_storage_enabled: false,
                blocked_reason: "等待当前 session 显式授权",
                next_action: "消费 approval request artifact",
              },
              credential_resolver: {
                status: "awaiting_session_credential",
                reference_id: "readonly_api_session",
                scope: "session",
                source: "user_session_config",
                secret_material_status: "not_requested",
                token_persisted: false,
                runtime_injection_enabled: false,
                blocked_reason: "等待当前 session 提供或确认凭证引用",
                next_action: "在 session scope 内解析 reference",
              },
              consumption_input_schema: {
                schema_id: "readonly_http_session_approval_v1",
                version: 1,
                fields: [
                  {
                    key: "session_user_approval",
                    label: "Session 授权确认",
                    kind: "boolean_confirmation",
                    required: true,
                    source: "user_confirmation",
                    secret: false,
                    description: "用户必须确认授权",
                  },
                  {
                    key: "runtime_endpoint_input",
                    label: "运行时 Endpoint",
                    kind: "url",
                    required: true,
                    source: "runtime_input",
                    secret: false,
                    description: "运行时输入 endpoint",
                  },
                  {
                    key: "credential_reference_confirmation",
                    label: "凭证引用确认",
                    kind: "credential_reference",
                    required: true,
                    source: "user_session_config",
                    secret: false,
                    description: "确认凭证引用",
                  },
                  {
                    key: "evidence_capture_consent",
                    label: "Evidence 捕获确认",
                    kind: "boolean_confirmation",
                    required: true,
                    source: "user_confirmation",
                    secret: false,
                    description: "确认捕获 evidence",
                  },
                ],
                ui_submission_enabled: false,
                runtime_execution_enabled: false,
                blocked_reason: "当前只定义 session 授权输入合同",
              },
              session_input_intake: {
                status: "awaiting_session_inputs",
                schema_id: "readonly_http_session_approval_v1",
                scope: "session",
                required_field_keys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                missing_field_keys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                collected_field_keys: [],
                credential_reference_id: "readonly_api_session",
                endpoint_input_persisted: false,
                secret_material_status: "not_collected",
                token_persisted: false,
                ui_submission_enabled: false,
                runtime_execution_enabled: false,
                blocked_reason: "已声明当前 session 输入槽位",
                next_action: "在当前 session 收集一次性授权输入",
              },
              session_input_submission_contract: {
                status: "submission_contract_declared",
                scope: "session",
                mode: "one_time_session_submission",
                accepted_field_keys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                validation_rules: [
                  {
                    field_key: "runtime_endpoint_input",
                    kind: "url",
                    required: true,
                    source: "runtime_input",
                    secret_allowed: false,
                    rule: "必须是 http/https URL",
                  },
                  {
                    field_key: "credential_reference_confirmation",
                    kind: "credential_reference",
                    required: true,
                    source: "user_session_config",
                    secret_allowed: false,
                    rule: "不接收 token 明文",
                  },
                ],
                value_retention: "none",
                endpoint_input_persisted: false,
                secret_material_accepted: false,
                token_persisted: false,
                evidence_capture_required: true,
                submission_handler_enabled: true,
                ui_submission_enabled: false,
                runtime_execution_enabled: false,
                blocked_reason: "已声明一次性 session 输入提交校验合同",
                next_action: "先接入 session-scoped submit handler",
              },
            },
          ],
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
          verificationGates: [
            {
              checkId: "readonly_http_execution_preflight",
              label: "只读 HTTP 执行 preflight",
              evidence: [
                { key: "method", value: "GET" },
                {
                  key: "credentialReferenceId",
                  value: "readonly_api_session",
                },
              ],
            },
          ],
          approvalRequests: [
            {
              approvalId: "capreg-1:readonly-http-session",
              status: "pending",
              sourceCheckId: "readonly_http_execution_preflight",
              skillDirectory: "capability-report",
              endpointSource: "runtime_input",
              method: "GET",
              credentialReferenceId: "readonly_api_session",
              evidenceSchema: [
                "request_url_hash",
                "request_method",
                "response_status",
                "response_sha256",
                "executed_at",
              ],
              policyPath: "policy/readonly-http-session.json",
              createdAt: "2026-05-05T01:10:00.000Z",
              consumptionGate: {
                status: "awaiting_session_approval",
                requiredInputs: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference:readonly_api_session",
                  "evidence_capture",
                ],
                runtimeExecutionEnabled: false,
                credentialStorageEnabled: false,
                blockedReason: "等待当前 session 显式授权",
                nextAction: "消费 approval request artifact",
              },
              credentialResolver: {
                status: "awaiting_session_credential",
                referenceId: "readonly_api_session",
                scope: "session",
                source: "user_session_config",
                secretMaterialStatus: "not_requested",
                tokenPersisted: false,
                runtimeInjectionEnabled: false,
                blockedReason: "等待当前 session 提供或确认凭证引用",
                nextAction: "在 session scope 内解析 reference",
              },
              consumptionInputSchema: {
                schemaId: "readonly_http_session_approval_v1",
                version: 1,
                fields: [
                  {
                    key: "session_user_approval",
                    label: "Session 授权确认",
                    kind: "boolean_confirmation",
                    required: true,
                    source: "user_confirmation",
                    secret: false,
                    description: "用户必须确认授权",
                  },
                  {
                    key: "runtime_endpoint_input",
                    label: "运行时 Endpoint",
                    kind: "url",
                    required: true,
                    source: "runtime_input",
                    secret: false,
                    description: "运行时输入 endpoint",
                  },
                  {
                    key: "credential_reference_confirmation",
                    label: "凭证引用确认",
                    kind: "credential_reference",
                    required: true,
                    source: "user_session_config",
                    secret: false,
                    description: "确认凭证引用",
                  },
                  {
                    key: "evidence_capture_consent",
                    label: "Evidence 捕获确认",
                    kind: "boolean_confirmation",
                    required: true,
                    source: "user_confirmation",
                    secret: false,
                    description: "确认捕获 evidence",
                  },
                ],
                uiSubmissionEnabled: false,
                runtimeExecutionEnabled: false,
                blockedReason: "当前只定义 session 授权输入合同",
              },
              sessionInputIntake: {
                status: "awaiting_session_inputs",
                schemaId: "readonly_http_session_approval_v1",
                scope: "session",
                requiredFieldKeys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                missingFieldKeys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                collectedFieldKeys: [],
                credentialReferenceId: "readonly_api_session",
                endpointInputPersisted: false,
                secretMaterialStatus: "not_collected",
                tokenPersisted: false,
                uiSubmissionEnabled: false,
                runtimeExecutionEnabled: false,
                blockedReason: "已声明当前 session 输入槽位",
                nextAction: "在当前 session 收集一次性授权输入",
              },
              sessionInputSubmissionContract: {
                status: "submission_contract_declared",
                scope: "session",
                mode: "one_time_session_submission",
                acceptedFieldKeys: [
                  "session_user_approval",
                  "runtime_endpoint_input",
                  "credential_reference_confirmation",
                  "evidence_capture_consent",
                ],
                validationRules: [
                  {
                    fieldKey: "runtime_endpoint_input",
                    kind: "url",
                    required: true,
                    source: "runtime_input",
                    secretAllowed: false,
                    rule: "必须是 http/https URL",
                  },
                  {
                    fieldKey: "credential_reference_confirmation",
                    kind: "credential_reference",
                    required: true,
                    source: "user_session_config",
                    secretAllowed: false,
                    rule: "不接收 token 明文",
                  },
                ],
                valueRetention: "none",
                endpointInputPersisted: false,
                secretMaterialAccepted: false,
                tokenPersisted: false,
                evidenceCaptureRequired: true,
                submissionHandlerEnabled: true,
                uiSubmissionEnabled: false,
                runtimeExecutionEnabled: false,
                blockedReason: "已声明一次性 session 输入提交校验合同",
                nextAction: "先接入 session-scoped submit handler",
              },
            },
          ],
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

  it("提交 approval session 输入时只走校验命令并归一化安全边界", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      approval_id: "capreg-1:readonly-http-session",
      session_id: "session-1",
      status: "validated_pending_runtime_gate",
      scope: "session",
      accepted_field_keys: [
        "session_user_approval",
        "runtime_endpoint_input",
        "credential_reference_confirmation",
        "evidence_capture_consent",
      ],
      missing_field_keys: [],
      rejected_field_keys: [],
      field_results: [
        {
          field_key: "runtime_endpoint_input",
          accepted: true,
          code: "accepted",
          message: "已通过 http/https URL 校验；值不会写入注册包。",
        },
      ],
      endpoint_input_persisted: false,
      secret_material_accepted: false,
      token_persisted: false,
      credential_resolved: false,
      value_retention: "none",
      evidence_capture_required: true,
      runtime_execution_enabled: false,
      next_gate: "readonly_http_controlled_get_preflight",
      controlled_get_preflight: {
        status: "ready_for_controlled_get_preflight",
        gate_id: "readonly_http_controlled_get_preflight",
        approval_id: "capreg-1:readonly-http-session",
        method: "GET",
        method_allowed: true,
        endpoint_source: "runtime_input",
        endpoint_validated: true,
        endpoint_value_returned: false,
        credential_reference_id: "readonly_api_session",
        credential_resolution_required: true,
        credential_resolved: false,
        evidence_schema: [
          "request_url_hash",
          "request_method",
          "response_status",
          "response_sha256",
          "executed_at",
        ],
        policy_path: "policy/readonly-http-session.json",
        request_execution_enabled: false,
        runtime_execution_enabled: false,
        blocked_reason:
          "session 输入已通过校验并到达受控 GET preflight；本阶段仍不解析凭证、不发真实 HTTP。",
        next_action:
          "后续只能在单独的受控 GET 门禁中解析 session 凭证引用、执行请求并写入 evidence。",
      },
      dry_preflight_plan: {
        status: "planned_without_execution",
        plan_id: "capreg-1:readonly-http-session:dry-preflight",
        gate_id: "readonly_http_controlled_get_preflight",
        approval_id: "capreg-1:readonly-http-session",
        method: "GET",
        method_allowed: true,
        request_url_hash: "abc123hash",
        request_url_hash_algorithm: "sha256",
        endpoint_value_returned: false,
        endpoint_input_persisted: false,
        credential_reference_id: "readonly_api_session",
        credential_resolution_stage: "not_started",
        credential_resolved: false,
        evidence_schema: [
          "request_url_hash",
          "request_method",
          "response_status",
          "response_sha256",
          "executed_at",
        ],
        planned_evidence_keys: [
          "request_url_hash",
          "request_method",
          "response_status",
          "response_sha256",
          "executed_at",
        ],
        policy_path: "policy/readonly-http-session.json",
        network_request_sent: false,
        response_captured: false,
        request_execution_enabled: false,
        runtime_execution_enabled: false,
        value_retention: "hash_only",
        blocked_reason:
          "已生成 dry preflight evidence plan；仅保留 URL hash，不执行请求、不解析凭证。",
        next_action:
          "下一刀才能在受控 GET 门禁中解析 session credential 并执行真实请求。",
      },
      blocked_reason:
        "session 输入已通过校验；值未持久化，后续仍需单独进入受控 GET 执行门禁。",
    });

    await expect(
      capabilityDraftsApi.submitApprovalSessionInputs({
        workspaceRoot: "/tmp/work",
        approvalId: "capreg-1:readonly-http-session",
        sessionId: "session-1",
        inputs: {
          session_user_approval: true,
          runtime_endpoint_input: "https://api.example.test/metrics",
          credential_reference_confirmation: "readonly_api_session",
          evidence_capture_consent: true,
        },
      }),
    ).resolves.toMatchObject({
      approvalId: "capreg-1:readonly-http-session",
      status: "validated_pending_runtime_gate",
      acceptedFieldKeys: expect.arrayContaining(["runtime_endpoint_input"]),
      fieldResults: [
        expect.objectContaining({
          fieldKey: "runtime_endpoint_input",
          accepted: true,
          code: "accepted",
        }),
      ],
      endpointInputPersisted: false,
      secretMaterialAccepted: false,
      tokenPersisted: false,
      credentialResolved: false,
      valueRetention: "none",
      runtimeExecutionEnabled: false,
      nextGate: "readonly_http_controlled_get_preflight",
      controlledGetPreflight: expect.objectContaining({
        status: "ready_for_controlled_get_preflight",
        gateId: "readonly_http_controlled_get_preflight",
        method: "GET",
        methodAllowed: true,
        endpointSource: "runtime_input",
        endpointValidated: true,
        endpointValueReturned: false,
        credentialReferenceId: "readonly_api_session",
        credentialResolutionRequired: true,
        credentialResolved: false,
        requestExecutionEnabled: false,
        runtimeExecutionEnabled: false,
        evidenceSchema: [
          "request_url_hash",
          "request_method",
          "response_status",
          "response_sha256",
          "executed_at",
        ],
      }),
      dryPreflightPlan: expect.objectContaining({
        status: "planned_without_execution",
        gateId: "readonly_http_controlled_get_preflight",
        requestUrlHash: "abc123hash",
        requestUrlHashAlgorithm: "sha256",
        endpointValueReturned: false,
        endpointInputPersisted: false,
        credentialReferenceId: "readonly_api_session",
        credentialResolutionStage: "not_started",
        credentialResolved: false,
        networkRequestSent: false,
        responseCaptured: false,
        requestExecutionEnabled: false,
        runtimeExecutionEnabled: false,
        valueRetention: "hash_only",
        plannedEvidenceKeys: [
          "request_url_hash",
          "request_method",
          "response_status",
          "response_sha256",
          "executed_at",
        ],
      }),
    });

    expect(safeInvoke).toHaveBeenCalledWith(
      "capability_draft_submit_approval_session_inputs",
      {
        request: expect.objectContaining({
          workspaceRoot: "/tmp/work",
          approvalId: "capreg-1:readonly-http-session",
          inputs: expect.objectContaining({
            runtime_endpoint_input: "https://api.example.test/metrics",
          }),
        }),
      },
    );
  });

  it("执行受控 GET 时应通过命令网关返回 evidence 且不持久化 endpoint/token", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      approval_id: "capreg-1:readonly-http-session",
      session_id: "session-1",
      status: "executed",
      scope: "session",
      gate_id: "readonly_http_controlled_get_execution",
      method: "GET",
      method_allowed: true,
      request_url_hash: "hash-123",
      request_url_hash_algorithm: "sha256",
      response_status: 200,
      response_sha256: "response-hash-123",
      response_bytes: 23,
      response_preview: '{"ok":true}',
      response_preview_truncated: false,
      executed_at: "2026-05-07T00:00:00.000Z",
      network_request_sent: true,
      response_captured: true,
      endpoint_value_returned: false,
      endpoint_input_persisted: false,
      credential_reference_id: "readonly_api_session",
      credential_resolved: false,
      token_persisted: false,
      request_execution_enabled: true,
      runtime_execution_enabled: false,
      value_retention: "ephemeral_response_preview",
      session_input_status: "validated_pending_runtime_gate",
      field_results: [
        {
          field_key: "runtime_endpoint_input",
          accepted: true,
          code: "accepted",
          message: "ok",
        },
      ],
      evidence: [
        { key: "request_url_hash", value: "hash-123" },
        { key: "response_status", value: "200" },
      ],
      evidence_artifact: {
        artifact_id: "controlled-get-artifact-1",
        relative_path:
          ".lime/capability-drafts/controlled-get-evidence/controlled-get-artifact-1.json",
        absolute_path:
          "/tmp/work/.lime/capability-drafts/controlled-get-evidence/controlled-get-artifact-1.json",
        content_sha256: "artifact-hash-123",
        persisted: true,
        contains_endpoint_value: false,
        contains_token_value: false,
        contains_response_preview: false,
      },
      blocked_reason:
        "受控 GET 已执行并返回当前命令结果；endpoint / token 均未持久化，未进入 runtime。",
      next_action:
        "后续才能把该 evidence 接回 runtime artifact / evidence pack 主链。",
    });

    await expect(
      capabilityDraftsApi.executeControlledGet({
        workspaceRoot: "/tmp/work",
        approvalId: "capreg-1:readonly-http-session",
        sessionId: "session-1",
        inputs: {
          session_user_approval: true,
          runtime_endpoint_input: "https://api.example.test/metrics",
          credential_reference_confirmation: "readonly_api_session",
          evidence_capture_consent: true,
        },
      }),
    ).resolves.toMatchObject({
      approvalId: "capreg-1:readonly-http-session",
      status: "executed",
      gateId: "readonly_http_controlled_get_execution",
      method: "GET",
      methodAllowed: true,
      requestUrlHash: "hash-123",
      responseStatus: 200,
      responseSha256: "response-hash-123",
      responseBytes: 23,
      responsePreview: '{"ok":true}',
      networkRequestSent: true,
      responseCaptured: true,
      endpointValueReturned: false,
      endpointInputPersisted: false,
      credentialResolved: false,
      tokenPersisted: false,
      requestExecutionEnabled: true,
      runtimeExecutionEnabled: false,
      sessionInputStatus: "validated_pending_runtime_gate",
      evidence: expect.arrayContaining([
        { key: "response_status", value: "200" },
      ]),
      evidenceArtifact: expect.objectContaining({
        artifactId: "controlled-get-artifact-1",
        persisted: true,
        containsEndpointValue: false,
        containsTokenValue: false,
        containsResponsePreview: false,
      }),
    });

    expect(safeInvoke).toHaveBeenCalledWith(
      "capability_draft_execute_controlled_get",
      {
        request: expect.objectContaining({
          workspaceRoot: "/tmp/work",
          approvalId: "capreg-1:readonly-http-session",
          inputs: expect.objectContaining({
            runtime_endpoint_input: "https://api.example.test/metrics",
          }),
        }),
      },
    );
  });
});
