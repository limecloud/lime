import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { METHOD_WORKSPACE_REGISTERED_SKILLS_LIST } from "../../../packages/app-server-client/src/protocol";
import { capabilityDraftsApi } from "./capabilityDrafts";

const appServerMock = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: vi.fn(function () {
    return appServerMock;
  }),
}));

describe("capabilityDraftsApi", () => {
  beforeEach(() => {
    vi.mocked(safeInvoke).mockReset();
    appServerMock.request.mockReset();
  });

  it("Capability Draft authoring 旧命令面已退役为 fail-closed", async () => {
    const retiredCalls = [
      () =>
        capabilityDraftsApi.create({
          workspaceRoot: "/tmp/work",
          name: "退役草案",
          description: "旧 authoring surface 不再作为生产入口。",
          userGoal: "验证 fail closed。",
          generatedFiles: [],
        }),
      () => capabilityDraftsApi.list({ workspaceRoot: "/tmp/work" }),
      () =>
        capabilityDraftsApi.get({
          workspaceRoot: "/tmp/work",
          draftId: "capdraft-1",
        }),
      () =>
        capabilityDraftsApi.verify({
          workspaceRoot: "/tmp/work",
          draftId: "capdraft-1",
        }),
      () =>
        capabilityDraftsApi.register({
          workspaceRoot: "/tmp/work",
          draftId: "capdraft-1",
        }),
      () =>
        capabilityDraftsApi.submitApprovalSessionInputs({
          workspaceRoot: "/tmp/work",
          approvalId: "approval-1",
          inputs: {},
        }),
      () =>
        capabilityDraftsApi.executeControlledGet({
          workspaceRoot: "/tmp/work",
          approvalId: "approval-1",
          inputs: {},
        }),
    ];

    for (const call of retiredCalls) {
      await expect(call()).rejects.toThrow(
        "Capability Draft authoring commands have no production current surface",
      );
    }

    expect(safeInvoke).not.toHaveBeenCalled();
    expect(appServerMock.request).not.toHaveBeenCalled();
  });

  it("读取 Workspace 已注册能力时应走 App Server current 并归一化返回", async () => {
    appServerMock.request.mockResolvedValueOnce({
      result: {
        skills: [
          {
            key: "daily-market-watch",
            name: "Daily Market Watch",
            description: "Read-only market monitoring skill.",
            directory: "daily-market-watch",
            registered_skill_directory:
              "/tmp/work/.agents/skills/daily-market-watch",
            registration: {
              registration_id: "capreg-1",
              registered_at: "2026-05-05T01:10:00.000Z",
              skill_directory: "daily-market-watch",
              registered_skill_directory:
                "/tmp/work/.agents/skills/daily-market-watch",
              source_draft_id: "capdraft-1",
              source_verification_report_id: "capver-1",
              generated_file_count: 4,
              permission_summary: ["Level 0 read-only"],
              verification_gates: [
                {
                  check_id: "readonly_http_execution_preflight",
                  label: "Read-only HTTP preflight",
                  evidence: [
                    { key: "method", value: "GET" },
                    { key: "", value: "drop-empty-key" },
                  ],
                },
              ],
              approval_requests: [
                {
                  approval_id: "approval-1",
                  status: "pending",
                  source_check_id: "readonly_http_execution_preflight",
                  skill_directory: "daily-market-watch",
                  endpoint_source: "runtime_input",
                  method: "GET",
                  credential_reference_id: "readonly_api_session",
                  evidence_schema: ["request_url_hash"],
                  policy_path: "policy/readonly-http-session.json",
                  created_at: "2026-05-05T01:11:00.000Z",
                  consumption_gate: {
                    status: "awaiting_session_approval",
                    required_inputs: ["session_user_approval"],
                    runtime_execution_enabled: false,
                    credential_storage_enabled: false,
                    blocked_reason: "awaiting user input",
                    next_action: "collect session input",
                  },
                  credential_resolver: {
                    status: "awaiting_session_credential",
                    reference_id: "readonly_api_session",
                    scope: "session",
                    source: "user_session_config",
                    secret_material_status: "not_requested",
                    token_persisted: false,
                    runtime_injection_enabled: false,
                    blocked_reason: "credential not resolved",
                    next_action: "confirm credential reference",
                  },
                  consumption_input_schema: {
                    schema_id: "readonly_http_session_approval_v1",
                    version: 1,
                    fields: [
                      {
                        key: "session_user_approval",
                        label: "Approve one-time read",
                        kind: "boolean",
                        required: true,
                        source: "user_session",
                        secret: false,
                        description: "Confirm the read-only request.",
                      },
                    ],
                    ui_submission_enabled: false,
                    runtime_execution_enabled: false,
                    blocked_reason: "manual approval only",
                  },
                  session_input_intake: {
                    status: "awaiting_session_inputs",
                    schema_id: "readonly_http_session_approval_v1",
                    scope: "session",
                    required_field_keys: ["session_user_approval"],
                    missing_field_keys: ["session_user_approval"],
                    collected_field_keys: [],
                    credential_reference_id: "readonly_api_session",
                    endpoint_input_persisted: false,
                    secret_material_status: "not_collected",
                    token_persisted: false,
                    ui_submission_enabled: false,
                    runtime_execution_enabled: false,
                    blocked_reason: "awaiting input",
                    next_action: "collect input",
                  },
                  session_input_submission_contract: {
                    status: "submission_contract_declared",
                    scope: "session",
                    mode: "one_time_session_submission",
                    accepted_field_keys: ["session_user_approval"],
                    validation_rules: [
                      {
                        field_key: "session_user_approval",
                        kind: "boolean",
                        required: true,
                        source: "user_session",
                        secret_allowed: false,
                        rule: "must be true",
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
                    blocked_reason: "not runtime-enabled",
                    next_action: "manual review",
                  },
                },
              ],
            },
            permission_summary: ["Level 0 read-only"],
            metadata: { provenance: "capability_draft" },
            allowed_tools: ["Read"],
            resource_summary: {
              has_scripts: true,
              has_references: false,
              has_assets: false,
            },
            standard_compliance: {
              is_standard: true,
              validation_errors: [],
              deprecated_fields: [],
            },
            launch_enabled: false,
            runtime_gate: "ready_for_manual_enable",
          },
        ],
      },
    });

    await expect(
      capabilityDraftsApi.listRegisteredSkills({
        workspaceRoot: " /tmp/work ",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        key: "daily-market-watch",
        registeredSkillDirectory:
          "/tmp/work/.agents/skills/daily-market-watch",
        permissionSummary: ["Level 0 read-only"],
        allowedTools: ["Read"],
        runtimeGate: "ready_for_manual_enable",
        resourceSummary: {
          hasScripts: true,
          hasReferences: false,
          hasAssets: false,
        },
        standardCompliance: {
          isStandard: true,
          validationErrors: [],
          deprecatedFields: [],
        },
        registration: expect.objectContaining({
          registrationId: "capreg-1",
          skillDirectory: "daily-market-watch",
          verificationGates: [
            {
              checkId: "readonly_http_execution_preflight",
              label: "Read-only HTTP preflight",
              evidence: [{ key: "method", value: "GET" }],
            },
          ],
          approvalRequests: [
            expect.objectContaining({
              approvalId: "approval-1",
              sourceCheckId: "readonly_http_execution_preflight",
              credentialReferenceId: "readonly_api_session",
              consumptionGate: expect.objectContaining({
                requiredInputs: ["session_user_approval"],
                runtimeExecutionEnabled: false,
              }),
              sessionInputSubmissionContract: expect.objectContaining({
                acceptedFieldKeys: ["session_user_approval"],
                runtimeExecutionEnabled: false,
              }),
            }),
          ],
        }),
      }),
    ]);

    expect(appServerMock.request).toHaveBeenCalledWith(
      METHOD_WORKSPACE_REGISTERED_SKILLS_LIST,
      {
        workspaceRoot: "/tmp/work",
      },
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("读取 Workspace 已注册能力缺少 App Server skills 数组时应 fail closed", async () => {
    appServerMock.request.mockResolvedValueOnce({ result: { skills: null } });

    await expect(
      capabilityDraftsApi.listRegisteredSkills({ workspaceRoot: "/tmp/work" }),
    ).rejects.toThrow(
      "App Server workspaceRegisteredSkills/list did not return skills",
    );
  });

  it("读取 Workspace 已注册能力缺少 workspaceRoot 时应 fail closed", async () => {
    await expect(
      capabilityDraftsApi.listRegisteredSkills({ workspaceRoot: "   " }),
    ).rejects.toThrow(
      "workspaceRoot is required to list App Server workspace registered skills",
    );

    expect(appServerMock.request).not.toHaveBeenCalled();
  });
});
