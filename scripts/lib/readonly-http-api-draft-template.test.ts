import { describe, expect, it } from "vitest";

import {
  buildReadonlyHttpApiCreateRequest,
  buildReadonlyHttpApiGeneratedFiles,
} from "./readonly-http-api-draft-template.mjs";

function contentByPath(files: Array<{ relativePath: string; content: string }>) {
  return new Map(files.map((file) => [file.relativePath, file.content]));
}

describe("readonly-http-api-draft-template", () => {
  it("默认生成 P6 verification 可接受的只读 HTTP/API 草案文件", () => {
    const files = buildReadonlyHttpApiGeneratedFiles();
    const contents = contentByPath(files);

    expect([...contents.keys()]).toEqual([
      "SKILL.md",
      "contract/input.schema.json",
      "contract/output.schema.json",
      "examples/input.sample.json",
      "tests/fixture.json",
      "tests/expected-output.json",
      "policy/readonly-http-session.json",
      "scripts/README.md",
      "scripts/dry-run.mjs",
    ]);
    const inputSchema = JSON.parse(
      contents.get("contract/input.schema.json") || "{}",
    );
    const sampleInput = JSON.parse(
      contents.get("examples/input.sample.json") || "{}",
    );
    expect(inputSchema.properties.fixture_path.type).toBe("string");
    expect(sampleInput.fixture_path).toBe("tests/fixture.json");
    expect(contents.get("tests/expected-output.json")).toContain(
      "fixture dry-run only",
    );
    const sessionPolicy = JSON.parse(
      contents.get("policy/readonly-http-session.json") || "{}",
    );
    expect(sessionPolicy).toMatchObject({
      mode: "session_required",
      access: "read-only",
      allowed_methods: ["GET"],
      credential_policy: "no_generated_credentials",
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
      },
    });
    expect(sessionPolicy.execution_preflight.evidence_schema).toContain(
      "response_sha256",
    );
    expect(sessionPolicy.evidence).toContain("response_sha256");
    expect(contents.get("scripts/dry-run.mjs")).toContain(
      "tests/expected-output.json",
    );
    expect(contents.get("scripts/dry-run.mjs")).toContain("console.log");
    expect(contents.get("scripts/dry-run.mjs")).not.toContain("fetch(");
    expect(contents.get("scripts/dry-run.mjs")).not.toContain("https://");
    expect(contents.get("SKILL.md")).toContain("不保存 token");
  });

  it("生成 capability_draft_create 请求时固定 api source 与只读权限输入", () => {
    const request = buildReadonlyHttpApiCreateRequest("/tmp/work", [
      "Level 0 只读发现",
      "允许只读 HTTP API GET 请求，不做外部写操作",
    ]);

    expect(request).toMatchObject({
      workspaceRoot: "/tmp/work",
      sourceKind: "api",
      sourceRefs: ["docs/exec-plans/skill-forge-readonly-http-api-p7-plan.md"],
      permissionSummary: [
        "Level 0 只读发现",
        "允许只读 HTTP API GET 请求，不做外部写操作",
      ],
    });
    expect(request.generatedFiles.map((file) => file.relativePath)).toContain(
      "scripts/dry-run.mjs",
    );
  });

  it("负向样例开关能稳定构造各个 P6 gate 的失败草案", () => {
    const missingFixtureInput = contentByPath(
      buildReadonlyHttpApiGeneratedFiles({ includeFixtureInput: false }),
    );
    expect(
      missingFixtureInput.get("contract/input.schema.json"),
    ).not.toContain("fixture_path");
    expect(missingFixtureInput.get("examples/input.sample.json")).not.toContain(
      "fixture_path",
    );
    expect(
      buildReadonlyHttpApiGeneratedFiles({ includeExpectedOutput: false }).some(
        (file) => file.relativePath === "tests/expected-output.json",
      ),
    ).toBe(false);
    expect(
      buildReadonlyHttpApiGeneratedFiles({ includeDryRunEntry: false }).some(
        (file) => file.relativePath === "scripts/dry-run.mjs",
      ),
    ).toBe(false);
    expect(
      buildReadonlyHttpApiGeneratedFiles({
        includeSessionAuthorization: false,
      }).some((file) => file.relativePath === "policy/readonly-http-session.json"),
    ).toBe(false);
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({
          includeCredentialReference: false,
        }),
      )
        .get("policy/readonly-http-session.json")
        ?.includes("credential_reference"),
    ).toBe(false);
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({
          includeExecutionPreflight: false,
        }),
      )
        .get("policy/readonly-http-session.json")
        ?.includes("execution_preflight"),
    ).toBe(false);
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({
          includeDryRunExpectedOutputBinding: false,
        }),
      ).get("scripts/dry-run.mjs"),
    ).not.toContain("tests/expected-output.json");
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({ includeNetworkedDryRun: true }),
      ).get("scripts/dry-run.mjs"),
    ).toContain("fetch(");
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({ includeDryRunMismatch: true }),
      ).get("scripts/dry-run.mjs"),
    ).toContain("mismatch: 0");
    expect(
      contentByPath(
        buildReadonlyHttpApiGeneratedFiles({ includeCredentialHeader: true }),
      ).get("scripts/client.ts"),
    ).toContain("Authorization");
  });
});
