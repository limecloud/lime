export function buildReadonlyHttpApiGeneratedFiles({
  includeFixture = true,
  includeExpectedOutput = true,
  includeFixtureInput = true,
  includeSessionAuthorization = true,
  includeCredentialReference = true,
  includeExecutionPreflight = true,
  includeDryRunEntry = true,
  includeDryRunExpectedOutputBinding = true,
  includeDryRunMismatch = false,
  includeNetworkedDryRun = false,
  includeCredentialHeader = false,
} = {}) {
  const files = [
    {
      relativePath: "SKILL.md",
      content: [
        "---",
        "name: 只读 HTTP API 每日报告",
        "description: 把公开只读 HTTP API 响应整理成 Markdown 趋势摘要。",
        "---",
        "",
        "# 只读 HTTP API 每日报告",
        "",
        "## 何时使用",
        "当用户需要读取公开只读 API 并生成趋势报告时使用。",
        "",
        "## 输入",
        "- endpoint: 只读 API 地址。",
        "- fixture_path: P6 dry-run 必须提供的本地 fixture 路径。",
        "",
        "## 执行步骤",
        "1. 仅允许 GET / fixture dry-run。",
        "2. 不发送 POST / PUT / PATCH / DELETE。",
        "3. 基于响应或 fixture 生成 Markdown 趋势摘要。",
        "",
        "## 输出",
        "- markdown_report: Markdown 趋势摘要。",
        "",
        "## 权限边界",
        "只读 HTTP API 访问；不保存 token，不发布，不删除，不写外部系统。",
      ].join("\n"),
    },
    {
      relativePath: "contract/input.schema.json",
      content: JSON.stringify(
        {
          type: "object",
          required: ["endpoint"],
          properties: {
            endpoint: { type: "string", format: "uri" },
            ...(includeFixtureInput ? { fixture_path: { type: "string" } } : {}),
          },
          additionalProperties: false,
        },
        null,
        2,
      ),
    },
    {
      relativePath: "contract/output.schema.json",
      content: JSON.stringify(
        {
          type: "object",
          required: ["markdown_report"],
          properties: {
            markdown_report: { type: "string" },
            evidence_notes: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        null,
        2,
      ),
    },
    {
      relativePath: "examples/input.sample.json",
      content: JSON.stringify(
        includeFixtureInput
          ? {
              endpoint: "https://api.example.test/metrics",
              fixture_path: "tests/fixture.json",
            }
          : {
              endpoint: "https://api.example.test/metrics",
            },
        null,
        2,
      ),
    },
    {
      relativePath: "scripts/README.md",
      content: [
        "# 只读 HTTP API wrapper",
        "",
        "P6 第一刀不发真实 HTTP 请求；只验证 GET / read-only API draft 的权限 gate。",
        "接入真实网络前必须继续使用 fixture dry-run、用户配置、session 授权和 evidence 记录。",
      ].join("\n"),
    },
  ];

  if (includeFixture) {
    files.splice(4, 0, {
      relativePath: "tests/fixture.json",
      content: JSON.stringify(
        {
          metrics: [
            { label: "workflow", value: 42 },
            { label: "approval", value: 18 },
            { label: "audit", value: 12 },
          ],
        },
        null,
        2,
      ),
    });
  }

  if (includeExpectedOutput) {
    files.splice(includeFixture ? 5 : 4, 0, {
      relativePath: "tests/expected-output.json",
      content: JSON.stringify(
        {
          markdown_report: "# 趋势摘要\n\n- workflow: 42\n- approval: 18\n- audit: 12",
          evidence_notes: ["fixture dry-run only"],
        },
        null,
        2,
      ),
    });
  }

  if (includeSessionAuthorization) {
    const insertIndex = files.findIndex((file) => file.relativePath === "scripts/README.md");
    files.splice(insertIndex === -1 ? files.length : insertIndex, 0, {
      relativePath: "policy/readonly-http-session.json",
      content: JSON.stringify(
        {
          mode: "session_required",
          access: "read-only",
          allowed_methods: ["GET"],
          credential_policy: "no_generated_credentials",
          credential_source: "user_session_config",
          ...(includeCredentialReference
            ? {
                credential_reference: {
                  scope: "session",
                  source: "user_session_config",
                  required: false,
                  reference_id: "readonly_api_session",
                },
              }
            : {}),
          ...(includeExecutionPreflight
            ? {
                execution_preflight: {
                  mode: "approval_request",
                  endpoint_source: "runtime_input",
                  method: "GET",
                  ...(includeCredentialReference
                    ? { credential_reference_id: "readonly_api_session" }
                    : {}),
                  evidence_schema: [
                    "request_url_hash",
                    "request_method",
                    "response_status",
                    "response_sha256",
                    "executed_at",
                  ],
                },
              }
            : {}),
          evidence: [
            "request_url_hash",
            "response_status",
            "response_sha256",
            "fixture_fallback",
          ],
        },
        null,
        2,
      ),
    });
  }

  if (includeDryRunEntry) {
    files.push({
      relativePath: "scripts/dry-run.mjs",
      content: includeNetworkedDryRun
        ? 'await fetch("https://api.example.test/metrics", { method: "GET" });'
        : [
            "import fs from 'node:fs';",
            "const input = JSON.parse(fs.readFileSync('examples/input.sample.json', 'utf8'));",
            "const fixture = JSON.parse(fs.readFileSync(input.fixture_path, 'utf8'));",
            ...(includeDryRunExpectedOutputBinding
              ? ["const expected = JSON.parse(fs.readFileSync('tests/expected-output.json', 'utf8'));"]
              : []),
            "const metrics = Array.isArray(fixture.metrics) ? fixture.metrics : [];",
            "const markdown = ['# 趋势摘要', '', ...metrics.map((item) => `- ${item.label}: ${item.value}`)].join('\\n');",
            includeDryRunMismatch
              ? "const actual = { markdown_report: '# 趋势摘要\\n\\n- mismatch: 0', evidence_notes: ['fixture dry-run only'] };"
              : "const actual = { markdown_report: markdown, evidence_notes: ['fixture dry-run only'] };",
            ...(includeDryRunExpectedOutputBinding
              ? [
                  "if (actual.markdown_report !== expected.markdown_report) throw new Error('dry-run output mismatch');",
                ]
              : []),
            "console.log(JSON.stringify(actual));",
          ].join("\n"),
    });
  }

  if (includeCredentialHeader) {
    files.push({
      relativePath: "scripts/client.ts",
      content:
        'await fetch(endpoint, { method: "GET", headers: { Authorization: `Bearer ${token}` } });',
    });
  }

  return files;
}

export function buildReadonlyHttpApiCreateRequest(
  workspaceRoot,
  permissionSummary,
  options = {},
) {
  return {
    workspaceRoot,
    name: "只读 HTTP API 每日报告",
    description: "把公开只读 HTTP API 响应整理成 Markdown 趋势摘要。",
    userGoal: "每天 9 点读取公开只读 API 或 fixture，生成 Markdown 趋势摘要。",
    sourceKind: "api",
    sourceRefs: ["docs/exec-plans/skill-forge-readonly-http-api-p7-plan.md"],
    permissionSummary,
    generatedFiles: buildReadonlyHttpApiGeneratedFiles(options),
  };
}
