import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = cwd();
const LIME_TRUNCATION_POLICY_SOURCE =
  "src/lib/model/modelTruncationPolicy.ts";
const DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/openai_models.rs";
const DEFAULT_UPSTREAM_PROTOCOL_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/protocol.rs";
const DEFAULT_UPSTREAM_MODELS_MANAGER_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/models-manager/src/model_info.rs";
const DEFAULT_UPSTREAM_TOOL_CALL_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/tools/src/tool_call.rs";
const UPSTREAM_OPENAI_MODELS_SOURCE =
  env.UPSTREAM_OPENAI_MODELS_SOURCE ?? DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE;
const UPSTREAM_PROTOCOL_SOURCE =
  env.UPSTREAM_PROTOCOL_SOURCE ?? DEFAULT_UPSTREAM_PROTOCOL_SOURCE;
const UPSTREAM_MODELS_MANAGER_SOURCE =
  env.UPSTREAM_MODELS_MANAGER_SOURCE ?? DEFAULT_UPSTREAM_MODELS_MANAGER_SOURCE;
const UPSTREAM_TOOL_CALL_SOURCE =
  env.UPSTREAM_TOOL_CALL_SOURCE ?? DEFAULT_UPSTREAM_TOOL_CALL_SOURCE;

const UPSTREAM_TRUNCATION_POLICY_MODEL_INFO_FIELDS = ["truncation_policy"];

const LIME_TRUNCATION_POLICY_INPUT_FIELDS = [
  "truncation_policy",
  "truncationPolicy",
];

const LIME_TRUNCATION_POLICY_FIELDS = [
  "mode",
  "limit",
  "truncation_policy",
];

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

function requireMatch(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  expect(match, `${label} not found`).not.toBeNull();
  return match?.groups?.body ?? match?.[1] ?? "";
}

function extractTypeFieldNames(source: string, name: string): string[] {
  const body = requireMatch(
    source,
    new RegExp(
      `export interface ${name} \\{\\n(?<body>[\\s\\S]*?)\\n\\}`,
      "u",
    ),
    name,
  );
  return [...body.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gmu)].map(
    (match) => match[1],
  );
}

function extractRustPubFieldNames(source: string, name: string): string[] {
  const body = requireMatch(
    source,
    new RegExp(`pub struct ${name} \\{\\n(?<body>[\\s\\S]*?)\\n\\}`, "u"),
    name,
  );
  return [...body.matchAll(/^\s+pub\s+([a-zA-Z_][a-zA-Z0-9_]*):/gmu)].map(
    (match) => match[1],
  );
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex, `${start} not found`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `${end} not found after ${start}`).toBeGreaterThanOrEqual(0);
  return source.slice(startIndex, endIndex);
}

describe("Codex model truncation policy origin", () => {
  it("ModelTruncationPolicyInput 只接收 Codex ModelInfo truncation_policy 字段", () => {
    const limeSource = readRepoFile(LIME_TRUNCATION_POLICY_SOURCE);

    expect(
      extractTypeFieldNames(limeSource, "ModelTruncationPolicyInput"),
    ).toEqual(LIME_TRUNCATION_POLICY_INPUT_FIELDS);
    expect(
      extractTypeFieldNames(limeSource, "ModelTruncationPolicy"),
    ).toEqual(LIME_TRUNCATION_POLICY_FIELDS);

    const upstreamOpenaiModelsSource = readIfExists(UPSTREAM_OPENAI_MODELS_SOURCE);
    if (!upstreamOpenaiModelsSource) {
      return;
    }

    const upstreamModelInfoFields = extractRustPubFieldNames(
      upstreamOpenaiModelsSource,
      "ModelInfo",
    );
    expect(
      upstreamModelInfoFields.filter((field) =>
        UPSTREAM_TRUNCATION_POLICY_MODEL_INFO_FIELDS.includes(field),
      ),
    ).toEqual(UPSTREAM_TRUNCATION_POLICY_MODEL_INFO_FIELDS);
  });

  it("截断模式和 fallback 默认值沿用 Codex TruncationPolicyConfig", () => {
    const limeSource = readRepoFile(LIME_TRUNCATION_POLICY_SOURCE);

    expect(limeSource).toContain('MODEL_TRUNCATION_MODES = ["bytes", "tokens"]');
    expect(limeSource).toContain("DEFAULT_TOOL_OUTPUT_TRUNCATION_BYTES = 10_000");
    expect(limeSource).toContain('mode: "bytes"');
    expect(limeSource).toContain("limit: DEFAULT_TOOL_OUTPUT_TRUNCATION_BYTES");

    const upstreamOpenaiModelsSource = readIfExists(UPSTREAM_OPENAI_MODELS_SOURCE);
    if (!upstreamOpenaiModelsSource) {
      return;
    }

    const truncationMode = sourceBetween(
      upstreamOpenaiModelsSource,
      "pub enum TruncationMode",
      "pub enum ToolMode",
    );
    const truncationConfig = sourceBetween(
      upstreamOpenaiModelsSource,
      "pub struct TruncationPolicyConfig",
      "/// Semantic version triple",
    );

    expect(truncationMode).toContain("Bytes");
    expect(truncationMode).toContain("Tokens");
    expect(truncationConfig).toContain("pub mode: TruncationMode");
    expect(truncationConfig).toContain("pub limit: i64");
    expect(truncationConfig).toContain("pub const fn bytes(limit: i64)");
    expect(truncationConfig).toContain("pub const fn tokens(limit: i64)");
  });

  it("Codex 将 ModelInfo truncation_policy 转成运行时 ToolCall 截断策略", () => {
    const upstreamProtocolSource = readIfExists(UPSTREAM_PROTOCOL_SOURCE);
    if (upstreamProtocolSource) {
      expect(upstreamProtocolSource).toContain(
        "#[serde(tag = \"mode\", content = \"limit\", rename_all = \"snake_case\")]",
      );
      const runtimeTruncationPolicy = sourceBetween(
        upstreamProtocolSource,
        "pub enum TruncationPolicy",
        "impl Mul<f64> for TruncationPolicy",
      );
      expect(runtimeTruncationPolicy).toContain("Bytes(usize)");
      expect(runtimeTruncationPolicy).toContain("Tokens(usize)");
      expect(runtimeTruncationPolicy).toContain(
        "impl From<crate::openai_models::TruncationPolicyConfig> for TruncationPolicy",
      );
    }

    const upstreamModelsManagerSource = readIfExists(UPSTREAM_MODELS_MANAGER_SOURCE);
    if (upstreamModelsManagerSource) {
      expect(upstreamModelsManagerSource).toContain("config.tool_output_token_limit");
      expect(upstreamModelsManagerSource).toContain(
        "model.truncation_policy = match model.truncation_policy.mode",
      );
      expect(upstreamModelsManagerSource).toContain(
        "TruncationPolicyConfig::bytes(/*limit*/ 10_000)",
      );
    }

    const codexToolCallSource = readIfExists(UPSTREAM_TOOL_CALL_SOURCE);
    if (codexToolCallSource) {
      expect(codexToolCallSource).toContain(
        "pub truncation_policy: TruncationPolicy",
      );
    }
  });
});
