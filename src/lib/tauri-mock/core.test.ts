import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeViaHttp: vi.fn(),
  isDevBridgeAvailable: vi.fn(),
  normalizeDevBridgeError: vi.fn((cmd: string, error: unknown) => {
    if (error instanceof Error) {
      return new Error(`[${cmd}] ${error.message}`);
    }
    return new Error(`[${cmd}] ${String(error)}`);
  }),
}));

vi.mock("../dev-bridge/http-client", () => ({
  invokeViaHttp: mocks.invokeViaHttp,
  isDevBridgeAvailable: mocks.isDevBridgeAvailable,
  normalizeDevBridgeError: mocks.normalizeDevBridgeError,
}));

vi.mock("../dev-bridge/mockPriorityCommands", () => ({
  shouldPreferMockInBrowser: vi.fn(() => false),
}));

import { shouldPreferMockInBrowser } from "../dev-bridge/mockPriorityCommands";
import { clearMocks, invoke, invokeMockOnly } from "./core";

describe("tauri-mock/core invoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMocks();
    mocks.isDevBridgeAvailable.mockReturnValue(true);
  });

  it("浏览器模式下 direct invoke 走 HTTP bridge", async () => {
    mocks.invokeViaHttp.mockResolvedValueOnce("/real/backend/root");

    const result = await invoke<string>("workspace_get_projects_root");

    expect(result).toBe("/real/backend/root");
    expect(mocks.invokeViaHttp).toHaveBeenCalledWith(
      "workspace_get_projects_root",
      undefined,
    );
  });

  it("mock 优先命令直接返回默认 mock，不访问 bridge", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("list_plugin_tasks", { taskState: null, limit: 300 }),
    ).resolves.toEqual([]);

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("显式 mock 入口不应再次探测 HTTP bridge", async () => {
    await expect(invokeMockOnly("get_config")).resolves.toEqual(
      expect.objectContaining({
        server: expect.objectContaining({
          port: 8787,
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("默认项目 mock 应返回可规范化的工作区对象", async () => {
    await expect(
      invokeMockOnly("get_or_create_default_project"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "workspace-default",
        workspace_type: "general",
        is_default: true,
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("图层设计工程目录 mock 应支持保存与读取闭环", async () => {
    const designJson = JSON.stringify({
      schemaVersion: "2026-05-05.p1",
      id: "mock-design",
      title: "Mock 图层设计",
      status: "draft",
      canvas: {
        width: 1080,
        height: 1440,
        backgroundColor: "#ffffff",
      },
      layers: [
        {
          id: "layer-title",
          name: "主标题",
          type: "text",
          visible: true,
          locked: false,
          opacity: 1,
          zIndex: 1,
          transform: { x: 120, y: 160, width: 360, height: 96, rotation: 0 },
          content: { text: "Smoke 标题" },
        },
      ],
      assets: [],
      editHistory: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    await expect(
      invokeMockOnly("save_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
          documentId: "mock-design",
          title: "Mock 图层设计",
          files: [
            {
              relativePath: "design.json",
              mimeType: "application/json",
              encoding: "utf8",
              content: designJson,
            },
            {
              relativePath: "assets/asset-subject.png",
              mimeType: "image/png",
              encoding: "base64",
              content: "YXNzZXQ=",
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-design.layered-design",
        fileCount: 2,
        assetCount: 1,
      }),
    );

    await expect(
      invokeMockOnly("read_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-design.layered-design",
        designJson: expect.stringContaining('"layer-title"'),
        fileCount: 2,
        assetCount: 1,
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("图层设计 OCR mock 应保持可回退但不伪造文字", async () => {
    await expect(
      invokeMockOnly("recognize_layered_design_text", {
        request: {
          imageSrc: "data:image/png;base64,ZmFrZQ==",
          width: 320,
          height: 120,
          candidateId: "headline-candidate",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        supported: false,
        engine: "mock-native-ocr",
        blocks: [],
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("图层设计工程目录 mock 应把远程引用资产计入缓存后的文件数", async () => {
    await expect(
      invokeMockOnly("save_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
          documentId: "mock-remote-design",
          title: "Mock 远程图层设计",
          files: [
            {
              relativePath: "design.json",
              mimeType: "application/json",
              encoding: "utf8",
              content:
                '{"assets":[{"id":"remote-asset","src":"https://example.com/hero.png"}]}',
            },
            {
              relativePath: "export-manifest.json",
              mimeType: "application/json",
              encoding: "utf8",
              content:
                '{"assets":[{"id":"remote-asset","source":"reference","originalSrc":"https://example.com/hero.png"}]}',
            },
            {
              relativePath: "psd-like-manifest.json",
              mimeType: "application/json",
              encoding: "utf8",
              content:
                '{"projectionKind":"psd-like-layer-stack","quality":{"extractionQuality":{"level":"review"}}}',
            },
            {
              relativePath: "preview.png",
              mimeType: "image/png",
              encoding: "base64",
              content: "cHJldmlldy1wbmc=",
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-remote-design.layered-design",
        fileCount: 5,
        assetCount: 1,
      }),
    );

    await expect(
      invokeMockOnly("read_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
          exportDirectoryRelativePath:
            ".lime/layered-designs/mock-remote-design.layered-design",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        psdLikeManifestPath:
          "/mock/workspace/.lime/layered-designs/mock-remote-design.layered-design/psd-like-manifest.json",
        psdLikeManifestJson: expect.stringContaining(
          '"projectionKind":"psd-like-layer-stack"',
        ),
      }),
    );
  });

  it("Capability Draft mock 应对齐只读 HTTP gate 与 dry-run evidence", async () => {
    const generatedFiles = [
      {
        relativePath: "SKILL.md",
        content:
          "# 只读 HTTP API 每日报告\n\n只读 HTTP API 访问；不保存 token，不写外部系统。",
      },
      {
        relativePath: "contract/input.schema.json",
        content: JSON.stringify({
          type: "object",
          required: ["endpoint"],
          properties: {
            endpoint: { type: "string", format: "uri" },
            fixture_path: { type: "string" },
          },
        }),
      },
      {
        relativePath: "contract/output.schema.json",
        content: JSON.stringify({
          type: "object",
          required: ["markdown_report"],
          properties: { markdown_report: { type: "string" } },
        }),
      },
      {
        relativePath: "examples/input.sample.json",
        content: JSON.stringify({
          endpoint: "https://api.example.test/metrics",
          fixture_path: "tests/fixture.json",
        }),
      },
      {
        relativePath: "tests/fixture.json",
        content: JSON.stringify({
          metrics: [{ label: "workflow", value: 42 }],
        }),
      },
      {
        relativePath: "tests/expected-output.json",
        content: JSON.stringify({
          markdown_report: "# 趋势摘要\n\n- workflow: 42",
        }),
      },
      {
        relativePath: "policy/readonly-http-session.json",
        content: JSON.stringify({
          mode: "session_required",
          access: "read-only",
          allowed_methods: ["GET"],
          credential_policy: "no_generated_credentials",
          credential_source: "user_session_config",
          credential_reference: {
            scope: "session",
            source: "user_session_config",
            required: false,
            reference_id: "readonly_api_session",
          },
          execution_preflight: {
            mode: "approval_request",
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
          },
          evidence: ["request_url_hash", "response_status", "response_sha256"],
        }),
      },
      {
        relativePath: "scripts/dry-run.mjs",
        content: [
          "import fs from 'node:fs';",
          "const input = JSON.parse(fs.readFileSync('examples/input.sample.json', 'utf8'));",
          "const fixture = JSON.parse(fs.readFileSync(input.fixture_path, 'utf8'));",
          "const expected = JSON.parse(fs.readFileSync('tests/expected-output.json', 'utf8'));",
          "console.log(JSON.stringify(expected));",
          "void fixture;",
        ].join("\n"),
      },
    ];

    const positiveDraft = await invokeMockOnly<Record<string, unknown>>(
      "capability_draft_create",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          name: "只读 HTTP API 每日报告",
          description: "把公开只读 HTTP API 响应整理成 Markdown 趋势摘要。",
          userGoal: "每天读取公开只读 API 或 fixture，生成 Markdown 摘要。",
          sourceKind: "api",
          permissionSummary: [
            "Level 0 只读发现",
            "允许只读 HTTP API GET 请求，不做外部写操作",
          ],
          generatedFiles,
        },
      },
    );

    const positiveVerification = await invokeMockOnly<any>(
      "capability_draft_verify",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: positiveDraft.draftId,
        },
      },
    );
    expect(positiveVerification.draft.verificationStatus).toBe(
      "verified_pending_registration",
    );
    const executeCheck = positiveVerification.report.checks.find(
      (check: { id?: string }) =>
        check.id === "readonly_http_fixture_dry_run_execute",
    );
    expect(executeCheck).toEqual(
      expect.objectContaining({
        status: "passed",
        evidence: expect.arrayContaining([
          { key: "scriptPath", value: "scripts/dry-run.mjs" },
          { key: "expectedOutputPath", value: "tests/expected-output.json" },
        ]),
      }),
    );
    const preflightCheck = positiveVerification.report.checks.find(
      (check: { id?: string }) =>
        check.id === "readonly_http_execution_preflight",
    );
    expect(preflightCheck).toEqual(
      expect.objectContaining({
        status: "passed",
        evidence: expect.arrayContaining([
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
        ]),
      }),
    );
    const positiveRegistration = await invokeMockOnly<any>(
      "capability_draft_register",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: positiveDraft.draftId,
        },
      },
    );
    expect(positiveRegistration.registration.approvalRequests).toEqual([
      expect.objectContaining({
        approvalId: expect.stringContaining(":readonly-http-session"),
        status: "pending",
        sourceCheckId: "readonly_http_execution_preflight",
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
        consumptionGate: expect.objectContaining({
          status: "awaiting_session_approval",
          requiredInputs: [
            "session_user_approval",
            "runtime_endpoint_input",
            "credential_reference:readonly_api_session",
            "evidence_capture",
          ],
          runtimeExecutionEnabled: false,
          credentialStorageEnabled: false,
        }),
        credentialResolver: expect.objectContaining({
          status: "awaiting_session_credential",
          referenceId: "readonly_api_session",
          scope: "session",
          source: "user_session_config",
          secretMaterialStatus: "not_requested",
          tokenPersisted: false,
          runtimeInjectionEnabled: false,
        }),
        consumptionInputSchema: expect.objectContaining({
          schemaId: "readonly_http_session_approval_v1",
          version: 1,
          uiSubmissionEnabled: false,
          runtimeExecutionEnabled: false,
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: "runtime_endpoint_input",
              kind: "url",
              required: true,
              secret: false,
            }),
            expect.objectContaining({
              key: "credential_reference_confirmation",
              kind: "credential_reference",
              source: "user_session_config",
              secret: false,
            }),
          ]),
        }),
        sessionInputIntake: expect.objectContaining({
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
        }),
        sessionInputSubmissionContract: expect.objectContaining({
          status: "submission_contract_declared",
          scope: "session",
          mode: "one_time_session_submission",
          acceptedFieldKeys: [
            "session_user_approval",
            "runtime_endpoint_input",
            "credential_reference_confirmation",
            "evidence_capture_consent",
          ],
          valueRetention: "none",
          endpointInputPersisted: false,
          secretMaterialAccepted: false,
          tokenPersisted: false,
          evidenceCaptureRequired: true,
          submissionHandlerEnabled: true,
          uiSubmissionEnabled: false,
          runtimeExecutionEnabled: false,
          validationRules: expect.arrayContaining([
            expect.objectContaining({
              fieldKey: "runtime_endpoint_input",
              kind: "url",
              required: true,
              secretAllowed: false,
            }),
            expect.objectContaining({
              fieldKey: "credential_reference_confirmation",
              kind: "credential_reference",
              source: "user_session_config",
              secretAllowed: false,
            }),
          ]),
        }),
      }),
    ]);
    const registeredSkills = await invokeMockOnly<any>(
      "capability_draft_list_registered_skills",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
        },
      },
    );
    expect(registeredSkills[0].registration.approvalRequests).toEqual(
      positiveRegistration.registration.approvalRequests,
    );
    const approvalSubmission = await invokeMockOnly<any>(
      "capability_draft_submit_approval_session_inputs",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          approvalId:
            positiveRegistration.registration.approvalRequests[0].approvalId,
          sessionId: "session-readonly-http",
          inputs: {
            session_user_approval: true,
            runtime_endpoint_input: "https://api.example.test/metrics",
            credential_reference_confirmation: "readonly_api_session",
            evidence_capture_consent: true,
          },
        },
      },
    );
    expect(approvalSubmission).toEqual(
      expect.objectContaining({
        status: "validated_pending_runtime_gate",
        scope: "session",
        acceptedFieldKeys: [
          "session_user_approval",
          "runtime_endpoint_input",
          "credential_reference_confirmation",
          "evidence_capture_consent",
        ],
        missingFieldKeys: [],
        rejectedFieldKeys: [],
        endpointInputPersisted: false,
        secretMaterialAccepted: false,
        tokenPersisted: false,
        credentialResolved: false,
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
          requestUrlHash: expect.stringMatching(/^mock-sha256-/),
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
      }),
    );
    const controlledGetExecution = await invokeMockOnly<any>(
      "capability_draft_execute_controlled_get",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          approvalId:
            positiveRegistration.registration.approvalRequests[0].approvalId,
          sessionId: "session-readonly-http",
          inputs: {
            session_user_approval: true,
            runtime_endpoint_input: "https://api.example.test/metrics",
            credential_reference_confirmation: "readonly_api_session",
            evidence_capture_consent: true,
          },
        },
      },
    );
    expect(controlledGetExecution).toEqual(
      expect.objectContaining({
        status: "executed",
        gateId: "readonly_http_controlled_get_execution",
        method: "GET",
        methodAllowed: true,
        requestUrlHash: expect.stringMatching(/^mock-sha256-/),
        responseStatus: 200,
        responseSha256: expect.stringMatching(/^mock-sha256-/),
        networkRequestSent: true,
        responseCaptured: true,
        endpointValueReturned: false,
        endpointInputPersisted: false,
        credentialReferenceId: "readonly_api_session",
        credentialResolved: false,
        tokenPersisted: false,
        requestExecutionEnabled: true,
        runtimeExecutionEnabled: false,
        valueRetention: "ephemeral_response_preview",
        sessionInputStatus: "validated_pending_runtime_gate",
        evidence: expect.arrayContaining([
          { key: "response_status", value: "200" },
        ]),
        evidenceArtifact: expect.objectContaining({
          persisted: true,
          containsEndpointValue: false,
          containsTokenValue: false,
          containsResponsePreview: false,
        }),
      }),
    );

    const missingSessionPolicyDraft = await invokeMockOnly<
      Record<string, unknown>
    >("capability_draft_create", {
      request: {
        workspaceRoot: "/tmp/lime-p6-mock",
        name: "缺授权策略只读 HTTP API 草案",
        description: "缺少 session authorization policy。",
        userGoal: "读取公开 API。",
        sourceKind: "api",
        permissionSummary: [
          "Level 0 只读发现",
          "允许只读 HTTP API GET 请求，不做外部写操作",
        ],
        generatedFiles: generatedFiles.filter(
          (file) => file.relativePath !== "policy/readonly-http-session.json",
        ),
      },
    });
    const missingSessionPolicyVerification = await invokeMockOnly<any>(
      "capability_draft_verify",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: missingSessionPolicyDraft.draftId,
        },
      },
    );
    const sessionAuthorizationCheck =
      missingSessionPolicyVerification.report.checks.find(
        (check: { id?: string }) =>
          check.id === "readonly_http_session_authorization",
      );
    expect(missingSessionPolicyVerification.draft.verificationStatus).toBe(
      "verification_failed",
    );
    expect(sessionAuthorizationCheck).toEqual(
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("authorization"),
      }),
    );

    const missingCredentialReferenceDraft = await invokeMockOnly<
      Record<string, unknown>
    >("capability_draft_create", {
      request: {
        workspaceRoot: "/tmp/lime-p6-mock",
        name: "缺凭证引用只读 HTTP API 草案",
        description: "缺少 credential_reference。",
        userGoal: "读取公开 API。",
        sourceKind: "api",
        permissionSummary: [
          "Level 0 只读发现",
          "允许只读 HTTP API GET 请求，不做外部写操作",
        ],
        generatedFiles: generatedFiles.map((file) =>
          file.relativePath === "policy/readonly-http-session.json"
            ? {
                ...file,
                content: JSON.stringify({
                  mode: "session_required",
                  access: "read-only",
                  allowed_methods: ["GET"],
                  credential_policy: "no_generated_credentials",
                  credential_source: "user_session_config",
                  evidence: [
                    "request_url_hash",
                    "response_status",
                    "response_sha256",
                  ],
                }),
              }
            : file,
        ),
      },
    });
    const missingCredentialReferenceVerification = await invokeMockOnly<any>(
      "capability_draft_verify",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: missingCredentialReferenceDraft.draftId,
        },
      },
    );
    const credentialReferenceCheck =
      missingCredentialReferenceVerification.report.checks.find(
        (check: { id?: string }) =>
          check.id === "readonly_http_credential_reference",
      );
    expect(
      missingCredentialReferenceVerification.draft.verificationStatus,
    ).toBe("verification_failed");
    expect(credentialReferenceCheck).toEqual(
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("credential_reference"),
      }),
    );

    const missingPreflightDraft = await invokeMockOnly<Record<string, unknown>>(
      "capability_draft_create",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          name: "缺执行前检查只读 HTTP API 草案",
          description: "缺少 execution_preflight。",
          userGoal: "读取公开 API。",
          sourceKind: "api",
          permissionSummary: [
            "Level 0 只读发现",
            "允许只读 HTTP API GET 请求，不做外部写操作",
          ],
          generatedFiles: generatedFiles.map((file) =>
            file.relativePath === "policy/readonly-http-session.json"
              ? {
                  ...file,
                  content: JSON.stringify({
                    mode: "session_required",
                    access: "read-only",
                    allowed_methods: ["GET"],
                    credential_policy: "no_generated_credentials",
                    credential_source: "user_session_config",
                    credential_reference: {
                      scope: "session",
                      source: "user_session_config",
                      required: false,
                      reference_id: "readonly_api_session",
                    },
                    evidence: [
                      "request_url_hash",
                      "response_status",
                      "response_sha256",
                    ],
                  }),
                }
              : file,
          ),
        },
      },
    );
    const missingPreflightVerification = await invokeMockOnly<any>(
      "capability_draft_verify",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: missingPreflightDraft.draftId,
        },
      },
    );
    const executionPreflightCheck =
      missingPreflightVerification.report.checks.find(
        (check: { id?: string }) =>
          check.id === "readonly_http_execution_preflight",
      );
    expect(missingPreflightVerification.draft.verificationStatus).toBe(
      "verification_failed",
    );
    expect(executionPreflightCheck).toEqual(
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("execution_preflight"),
      }),
    );

    const negativeDraft = await invokeMockOnly<Record<string, unknown>>(
      "capability_draft_create",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          name: "缺权限只读 HTTP API 草案",
          description: "缺少网络只读权限声明。",
          userGoal: "读取公开 API。",
          sourceKind: "api",
          permissionSummary: ["Level 0 只读发现"],
          generatedFiles,
        },
      },
    );
    const negativeVerification = await invokeMockOnly<any>(
      "capability_draft_verify",
      {
        request: {
          workspaceRoot: "/tmp/lime-p6-mock",
          draftId: negativeDraft.draftId,
        },
      },
    );
    const riskCheck = negativeVerification.report.checks.find(
      (check: { id?: string }) => check.id === "static_risk_scan",
    );
    expect(negativeVerification.draft.verificationStatus).toBe(
      "verification_failed",
    );
    expect(riskCheck).toEqual(
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("网络只读权限"),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("知识库 mock 应保持导入后的列表与详情一致", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    await expect(
      invoke("knowledge_list_packs", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        packs: [],
      }),
    );

    await expect(
      invoke("knowledge_import_source", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          packName: "brand-product-demo",
          description: "品牌产品知识包",
          packType: "brand-product",
          sourceFileName: "source.md",
          sourceText: "产品面向内容团队，禁止编造价格。",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        pack: expect.objectContaining({
          metadata: expect.objectContaining({
            name: "brand-product-demo",
            description: "品牌产品知识包",
            status: "needs-review",
            type: "brand-product",
            metadata: expect.objectContaining({
              limeTemplate: "brand-product",
            }),
          }),
        }),
      }),
    );

    await expect(
      invoke("knowledge_list_packs", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        packs: expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              name: "brand-product-demo",
              description: "品牌产品知识包",
            }),
          }),
        ]),
      }),
    );

    await expect(
      invoke("knowledge_get_pack", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: "brand-product-demo",
          description: "品牌产品知识包",
        }),
        sources: expect.arrayContaining([
          expect.objectContaining({
            relativePath: "sources/source.md",
            preview: "产品面向内容团队，禁止编造价格。",
          }),
        ]),
      }),
    );

    await expect(
      invoke("knowledge_update_pack_status", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
          status: "ready",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        previousStatus: "needs-review",
        clearedDefault: false,
        pack: expect.objectContaining({
          metadata: expect.objectContaining({
            status: "ready",
            trust: "user-confirmed",
          }),
        }),
      }),
    );

    await expect(
      invoke("knowledge_resolve_context", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
          task: "写产品介绍",
          writeRun: true,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        packName: "brand-product-demo",
        selectedFiles: ["compiled/splits/brand-product-demo/应用指南.md"],
        sourceAnchors: ["sources/source.md"],
        warnings: [],
        runId: expect.stringContaining("context-"),
        runPath: expect.stringContaining("/runs/context-"),
      }),
    );

    await expect(
      invoke("knowledge_validate_context_run", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
          runPath: "runs/context-mock.json",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        runId: "context-mock",
      }),
    );

    await expect(
      invoke("knowledge_set_default_pack", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        defaultPackName: "brand-product-demo",
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp 自动化命令在浏览器模式下应返回结构化结果", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_create_automation_job", {
        intent: {
          launchIntent: {
            sceneappId: "daily-trend-briefing",
            workspaceId: "workspace-default",
            userInput: "关注 AI Agent 趋势",
          },
          runNow: true,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        jobId: expect.any(String),
        runNowResult: expect.objectContaining({
          success_count: 1,
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp 运行前规划应返回 adapter plan 草稿", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "x-article-export",
          workspaceId: "workspace-default",
          projectId: "project-research",
          slots: {
            article_url: "https://x.com/openai/article/123",
            target_language: "中文",
          },
          runtimeContext: {
            browserSessionAttached: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 2,
          }),
        }),
        projectPackPlan: expect.objectContaining({
          completionStrategy: "required_parts_complete",
          requiredParts: ["index.md", "meta.json"],
        }),
        plan: expect.objectContaining({
          adapterPlan: expect.objectContaining({
            runtimeAction: "launch_browser_assist",
            targetRef: "x/article-export",
            preferredProfileKey: "general_browser_assist",
            launchPayload: expect.objectContaining({
              adapter_name: "x/article-export",
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp preview 规划不应自动写入 context snapshot", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    const firstPlan = await invoke("sceneapp_plan_launch", {
      intent: {
        sceneappId: "story-video-suite",
        workspaceId: "workspace-default",
        projectId: "project-video",
        userInput: "根据发布会亮点生成 30 秒短视频草稿",
        runtimeContext: {
          directorySessionReadyCompat: true,
        },
      },
    });

    const secondPlan = await invoke("sceneapp_plan_launch", {
      intent: {
        sceneappId: "story-video-suite",
        workspaceId: "workspace-default",
        projectId: "project-video",
        runtimeContext: {
          directorySessionReadyCompat: true,
        },
      },
    });

    expect(firstPlan).toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
          }),
        }),
      }),
    );
    expect(secondPlan).toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            notes: expect.not.arrayContaining([
              expect.stringContaining("已从项目上下文恢复"),
              expect.stringContaining(
                "当前 planning 直接复用了 1 条项目级参考",
              ),
            ]),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp mock 应在同一项目内复用上一次 context snapshot", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    await expect(
      invoke("sceneapp_save_context_baseline", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          userInput: "根据发布会亮点生成 30 秒短视频草稿",
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
            notes: expect.arrayContaining([
              expect.stringContaining("已写入项目级 Context Snapshot"),
            ]),
          }),
          snapshot: expect.objectContaining({
            referenceItems: expect.arrayContaining([
              expect.objectContaining({
                usageCount: 1,
              }),
            ]),
          }),
        }),
      }),
    );

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
            notes: expect.arrayContaining([
              expect.stringContaining("已从项目上下文恢复 1 条历史参考"),
              expect.stringContaining(
                "当前 planning 直接复用了 1 条项目级参考",
              ),
              expect.stringContaining("当前已复用项目级 TasteProfile"),
            ]),
          }),
          snapshot: expect.objectContaining({
            tasteProfile: expect.objectContaining({
              summary:
                "当前 TasteProfile 已在项目沉淀基础上，结合 1 条参考输入更新启发式摘要。",
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("legacy cloudSessionReady 输入也应继续产出 current service_scene planner", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          runtimeContext: {
            cloudSessionReady: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          bindingFamily: "agent_turn",
          adapterPlan: expect.objectContaining({
            adapterKind: "agent_turn",
            runtimeAction: "open_service_scene_session",
            requestMetadata: expect.objectContaining({
              harness: expect.objectContaining({
                service_scene_launch: expect.objectContaining({
                  kind: "local_service_skill",
                }),
              }),
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp mock 应把 referenceMemoryIds 编译成正式参考对象并透传到 adapter 合同", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          userInput: "把这次新品卖点整理成 30 秒短视频方案",
          referenceMemoryIds: ["memory-1", "memory-2"],
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 3,
            notes: expect.arrayContaining([
              expect.stringContaining("显式带入 2 条灵感对象"),
            ]),
          }),
          snapshot: expect.objectContaining({
            referenceItems: expect.arrayContaining([
              expect.objectContaining({
                id: "memory:memory-1",
                label: "夏日短视频语气",
                sourceKind: "reference_library",
              }),
              expect.objectContaining({
                id: "memory:memory-2",
                label: "爆款封面参考",
                sourceKind: "reference_library",
              }),
            ]),
            tasteProfile: expect.objectContaining({
              keywords: expect.arrayContaining([
                "夏日短视频语气",
                "爆款封面参考",
              ]),
            }),
          }),
        }),
        plan: expect.objectContaining({
          adapterPlan: expect.objectContaining({
            launchPayload: expect.objectContaining({
              reference_memory_ids: ["memory-1", "memory-2"],
            }),
            requestMetadata: expect.objectContaining({
              sceneapp_reference_memory_ids: ["memory-1", "memory-2"],
              harness: expect.objectContaining({
                sceneapp_launch: expect.objectContaining({
                  reference_memory_ids: ["memory-1", "memory-2"],
                }),
              }),
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("工具库存 fallback mock 不应再返回空壳清单", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      const result = await invoke("agent_runtime_get_tool_inventory", {
        request: {
          caller: "assistant",
          browserAssist: true,
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          request: expect.objectContaining({
            caller: "assistant",
            surface: expect.objectContaining({
              browser_assist: true,
            }),
          }),
          default_allowed_tools: expect.arrayContaining([
            "ToolSearch",
            "ListMcpResourcesTool",
            "ReadMcpResourceTool",
            "WebSearch",
            "AskUserQuestion",
            "SendUserMessage",
            "Agent",
            "SendMessage",
            "TeamCreate",
            "TeamDelete",
            "ListPeers",
            "TaskCreate",
            "Workflow",
            "lime_site_recommend",
            "lime_site_run",
          ]),
          counts: expect.objectContaining({
            catalog_total: 46,
            registry_visible_total: expect.any(Number),
            extension_tool_total: 20,
            extension_tool_visible_total: 1,
            mcp_tool_total: 20,
            mcp_tool_visible_total: 1,
          }),
          catalog_tools: expect.arrayContaining([
            expect.objectContaining({ name: "ToolSearch" }),
            expect.objectContaining({ name: "ListMcpResourcesTool" }),
            expect.objectContaining({
              name: "Bash",
              permission_plane: "parameter_restricted",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "WebSearch" }),
            expect.objectContaining({
              name: "WebFetch",
              permission_plane: "parameter_restricted",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "SendUserMessage" }),
            expect.objectContaining({
              name: "StructuredOutput",
              permission_plane: "session_allowlist",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "RemoteTrigger" }),
            expect.objectContaining({ name: "CronCreate" }),
            expect.objectContaining({ name: "lime_site_list" }),
            expect.objectContaining({ name: "lime_site_run" }),
            expect.objectContaining({
              name: "mcp__lime-browser__",
              source: "browser_compatibility",
              permission_plane: "caller_filtered",
              workspace_default_allow: false,
            }),
          ]),
          extension_surfaces: expect.arrayContaining([
            expect.objectContaining({
              extension_name: "mcp__lime-browser",
              available_tools: expect.arrayContaining([
                "navigate",
                "click",
                "read_page",
                "get_page_text",
              ]),
              loaded_tools: ["mcp__lime-browser__navigate"],
              searchable_tools: expect.arrayContaining([
                "mcp__lime-browser__navigate",
                "mcp__lime-browser__click",
              ]),
            }),
          ]),
          registry_tools: expect.arrayContaining([
            expect.objectContaining({ name: "AskUserQuestion" }),
            expect.objectContaining({ name: "SendUserMessage" }),
            expect.objectContaining({ name: "StructuredOutput" }),
            expect.objectContaining({ name: "ReadMcpResourceTool" }),
            expect.objectContaining({ name: "EnterPlanMode" }),
            expect.objectContaining({ name: "SendMessage" }),
            expect.objectContaining({ name: "TeamCreate" }),
            expect.objectContaining({ name: "TeamDelete" }),
            expect.objectContaining({ name: "ListPeers" }),
            expect.objectContaining({ name: "CronList" }),
            expect.objectContaining({ name: "TaskOutput" }),
            expect.objectContaining({ name: "ExitWorktree" }),
            expect.objectContaining({ name: "lime_site_search" }),
          ]),
          extension_tools: expect.arrayContaining([
            expect.objectContaining({
              name: "mcp__lime-browser__navigate",
              status: "loaded",
              visible_in_context: true,
            }),
            expect.objectContaining({
              name: "mcp__lime-browser__click",
              status: "deferred",
              visible_in_context: false,
            }),
          ]),
          mcp_tools: expect.arrayContaining([
            expect.objectContaining({
              name: "mcp__lime-browser__navigate",
              always_visible: true,
              visible_in_context: true,
              tags: ["browser", "write"],
            }),
            expect.objectContaining({
              name: "mcp__lime-browser__click",
              deferred_loading: true,
              visible_in_context: false,
              tags: ["browser", "write"],
            }),
          ]),
        }),
      );
      expect(result.default_allowed_tools).not.toContain("StructuredOutput");
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("review decision mock 应阻止 denied 权限确认保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受被拒绝的权限确认。",
          risk_level: "low",
        },
      }),
    ).rejects.toThrow("真实权限确认已被拒绝");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "权限确认已拒绝，拒绝本次交付。",
          risk_level: "high",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        permission_confirmation_status: "denied",
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("review decision mock 应阻止未解决权限确认保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受尚未发起审批的权限确认。",
          risk_level: "low",
          permission_status: "requires_confirmation",
          permission_confirmation_status: "not_requested",
          permission_confirmation_source: "declared_profile_only",
        },
      }),
    ).rejects.toThrow("权限确认尚未解决");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "权限确认未解决，拒绝本次交付。",
          risk_level: "high",
          permission_status: "requires_confirmation",
          permission_confirmation_status: "not_requested",
          permission_confirmation_source: "declared_profile_only",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        permission_confirmation_status: "not_requested",
        permission_confirmation_source: "declared_profile_only",
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("review decision mock 应阻止用户锁定能力缺口保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受模型锁定能力缺口。",
          risk_level: "low",
          limit_status: "user_locked_capability_gap",
          capability_gap: "browser_reasoning_candidate_missing",
          permission_status: "not_required",
          permission_confirmation_status: "resolved",
        },
      }),
    ).rejects.toThrow("显式用户模型锁定");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "模型锁定能力缺口未解决，拒绝本次交付。",
          risk_level: "high",
          limit_status: "user_locked_capability_gap",
          capability_gap: "browser_reasoning_candidate_missing",
          permission_status: "not_required",
          permission_confirmation_status: "resolved",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        limit_status: "user_locked_capability_gap",
        capability_gap: "browser_reasoning_candidate_missing",
        user_locked_capability_summary: expect.stringContaining(
          "显式用户模型锁定不满足当前 execution profile",
        ),
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("工具库存 fallback mock 应按 workbench + browser surface 补齐当前工具面", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      const result = await invoke("agent_runtime_get_tool_inventory", {
        request: {
          caller: "assistant",
          workbench: true,
          browserAssist: true,
        },
      });

      expect(result.request.surface).toEqual(
        expect.objectContaining({
          workbench: true,
          browser_assist: true,
        }),
      );
      expect(result.counts.catalog_total).toBe(57);
      expect(result.default_allowed_tools).toEqual(
        expect.arrayContaining([
          "social_generate_cover_image",
          "lime_create_image_generation_task",
          "lime_create_transcription_task",
          "lime_run_service_skill",
          "lime_site_recommend",
          "lime_site_run",
        ]),
      );
      expect(result.default_allowed_tools).not.toContain("mcp__lime-browser__");
      expect(result.catalog_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "social_generate_cover_image" }),
          expect.objectContaining({
            name: "lime_create_image_generation_task",
          }),
          expect.objectContaining({ name: "lime_run_service_skill" }),
          expect.objectContaining({ name: "lime_site_recommend" }),
          expect.objectContaining({ name: "mcp__lime-browser__" }),
        ]),
      );
      expect(result.registry_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "social_generate_cover_image" }),
          expect.objectContaining({ name: "lime_search_web_images" }),
          expect.objectContaining({ name: "lime_create_typesetting_task" }),
          expect.objectContaining({ name: "lime_site_info" }),
        ]),
      );
      expect(result.counts.mcp_tool_total).toBe(20);
      expect(result.mcp_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "mcp__lime-browser__navigate" }),
          expect.objectContaining({ name: "mcp__lime-browser__read_page" }),
          expect.objectContaining({ name: "mcp__lime-browser__click" }),
        ]),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("bridge 失败且命令存在 mock 时回退默认 mock 数据", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("workspace_get_projects_root")).resolves.toBe(
        "/mock/workspace/projects",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("媒体任务命令在 bridge 失败时应回退统一 task file mock 协议", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(
        invoke("list_media_task_artifacts", {
          request: {
            projectRootPath: "/mock/workspace",
            taskFamily: "image",
            threadId: "thread-image-mock-1",
            turnId: "turn-image-mock-1",
            contentId: "content-image-mock-1",
            model: "gpt-image-1",
            costState: { status: "estimated", estimatedCostClass: "low" },
            limitState: { status: "within_limit" },
            limitEvent: { eventKind: "quota_low" },
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          success: true,
          total: 1,
          modality_runtime_contracts: expect.objectContaining({
            snapshot_count: 1,
            contract_keys: ["image_generation"],
            entry_keys: ["at_image_command"],
            thread_ids: ["thread-image-mock-1"],
            turn_ids: ["turn-image-mock-1"],
            content_ids: ["content-image-mock-1"],
            modalities: ["image"],
            skill_ids: ["image_generate"],
            model_ids: ["gpt-image-1"],
            cost_states: ["estimated"],
            limit_states: ["within_limit"],
            estimated_cost_classes: ["low"],
            limit_event_kinds: ["quota_low"],
            quota_low_count: 1,
            execution_profile_keys: ["image_generation_profile"],
            executor_adapter_keys: ["skill:image_generate"],
            executor_kinds: ["skill"],
            executor_binding_keys: ["image_generate"],
            limecore_policy_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_snapshot_count: 1,
            limecore_policy_decisions: ["allow"],
            limecore_policy_decision_sources: ["local_default_policy"],
            limecore_policy_unresolved_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_missing_inputs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_pending_hit_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_value_hit_count: 0,
            snapshots: expect.arrayContaining([
              expect.objectContaining({
                entry_key: "at_image_command",
                thread_id: "thread-image-mock-1",
                turn_id: "turn-image-mock-1",
                content_id: "content-image-mock-1",
                modality: "image",
                skill_id: "image_generate",
                model_id: "gpt-image-1",
                cost_state: "estimated",
                limit_state: "within_limit",
                estimated_cost_class: "low",
                limit_event_kind: "quota_low",
                quota_low: true,
                executor_kind: "skill",
                executor_binding_key: "image_generate",
                limecore_policy_refs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_snapshot_status: "local_defaults_evaluated",
                limecore_policy_decision_source: "local_default_policy",
                limecore_policy_missing_inputs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_pending_hit_refs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_value_hits: [],
                limecore_policy_value_hit_count: 0,
              }),
            ]),
          }),
          tasks: expect.arrayContaining([
            expect.objectContaining({
              task_type: "image_generate",
              task_family: "image",
            }),
          ]),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("媒体任务 mock 在 taskRef 为绝对 task file 时也应保持稳定 task_id", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    const directResult = await invoke("get_media_task_artifact", {
      request: {
        projectRootPath: "/mock/workspace",
        taskRef: "task-image-mock-1",
      },
    });
    const absolutePathResult = await invoke("get_media_task_artifact", {
      request: {
        projectRootPath: "/mock/workspace",
        taskRef:
          "/mock/workspace/.lime/tasks/image_generate/task-image-mock-1.json",
      },
    });

    expect(directResult).toEqual(
      expect.objectContaining({
        task_id: "task-image-mock-1",
        path: ".lime/tasks/image_generate/task-image-mock-1.json",
      }),
    );
    expect(absolutePathResult).toEqual(
      expect.objectContaining({
        task_id: "task-image-mock-1",
        path: ".lime/tasks/image_generate/task-image-mock-1.json",
      }),
    );
  });

  it("音频任务命令在 bridge 失败时应回退 voice_generation task file mock 协议", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    await expect(
      invoke("create_audio_generation_task_artifact", {
        request: {
          projectRootPath: "/mock/workspace",
          sourceText: "请生成温暖旁白",
          voice: "warm_narrator",
          modalityContractKey: "voice_generation",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_type: "audio_generate",
        task_family: "audio",
        path: ".lime/tasks/audio_generate/task-audio-mock-1.json",
        record: expect.objectContaining({
          payload: expect.objectContaining({
            modality_contract_key: "voice_generation",
            modality: "audio",
            routing_slot: "voice_generation_model",
            audio_output: expect.objectContaining({
              kind: "audio_output",
              status: "pending",
              mime_type: "audio/mpeg",
            }),
          }),
        }),
      }),
    );

    await expect(
      invoke("list_media_task_artifacts", {
        request: {
          projectRootPath: "/mock/workspace",
          taskFamily: "audio",
          taskType: "audio_generate",
          modalityContractKey: "voice_generation",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        modality_runtime_contracts: expect.objectContaining({
          contract_keys: ["voice_generation"],
          execution_profile_keys: ["voice_generation_profile"],
          executor_adapter_keys: ["service_skill:voice_runtime"],
          limecore_policy_refs: [
            "client_scenes",
            "tenant_feature_flags",
            "provider_offer",
          ],
          limecore_policy_snapshot_count: 1,
          audio_output_count: 1,
          audio_output_statuses: [{ status: "pending", count: 1 }],
          snapshots: expect.arrayContaining([
            expect.objectContaining({
              task_type: "audio_generate",
              contract_key: "voice_generation",
              execution_profile_key: "voice_generation_profile",
              executor_adapter_key: "service_skill:voice_runtime",
              executor_kind: "service_skill",
              executor_binding_key: "voice_runtime",
              limecore_policy_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_snapshot_status: "local_defaults_evaluated",
              limecore_policy_decision: "allow",
              limecore_policy_decision_source: "local_default_policy",
              limecore_policy_unresolved_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_missing_inputs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_pending_hit_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_value_hits: [],
              limecore_policy_value_hit_count: 0,
              routing_event: "executor_invoked",
              audio_output_status: "pending",
            }),
          ]),
        }),
      }),
    );

    await expect(
      invoke("complete_audio_generation_task_artifact", {
        request: {
          projectRootPath: "/mock/workspace",
          taskRef: "task-audio-mock-1",
          audioPath: ".lime/runtime/audio/task-audio-mock-1.mp3",
          mimeType: "audio/mpeg",
          durationMs: 1800,
          providerId: "limecore",
          model: "voice-pro",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_type: "audio_generate",
        task_family: "audio",
        normalized_status: "succeeded",
        record: expect.objectContaining({
          payload: expect.objectContaining({
            audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
            audio_output: expect.objectContaining({
              status: "completed",
              audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
              duration_ms: 1800,
            }),
          }),
          result: expect.objectContaining({
            status: "completed",
            audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
          }),
        }),
      }),
    );
  });

  it("OpenClaw 环境状态命令在 bridge 失败时回退默认 mock", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("openclaw_get_environment_status")).resolves.toEqual(
        expect.objectContaining({
          recommendedAction: "install_openclaw",
          summary: "运行环境已就绪，可以继续一键安装 OpenClaw。",
          diagnostics: expect.objectContaining({
            npmPath: "/opt/homebrew/bin/npm",
            npmGlobalPrefix: "/opt/homebrew",
          }),
          node: expect.objectContaining({ status: "ok" }),
          git: expect.objectContaining({ status: "ok" }),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("旧 Agent 命令别名应直接报废弃错误，不再静默返回 mock 成功结果", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    await expect(invoke("list_agent_sessions")).rejects.toThrow(
      "命令 list_agent_sessions 已废弃，请迁移到 agent_runtime_list_sessions",
    );
    await expect(invoke("get_agent_process_status")).rejects.toThrow(
      "命令 get_agent_process_status 已废弃，请迁移到 agent_get_process_status",
    );
  });
});
