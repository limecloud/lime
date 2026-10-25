import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = cwd();
const LIME_RESPONSES_POLICY_SOURCE = "src/lib/model/modelResponsesPolicy.ts";
const DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/openai_models.rs";
const DEFAULT_UPSTREAM_CLIENT_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/core/src/client.rs";
const UPSTREAM_OPENAI_MODELS_SOURCE =
  env.UPSTREAM_OPENAI_MODELS_SOURCE ?? DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE;
const UPSTREAM_CLIENT_SOURCE =
  env.UPSTREAM_CLIENT_SOURCE ?? DEFAULT_UPSTREAM_CLIENT_SOURCE;

const UPSTREAM_RESPONSES_POLICY_MODEL_INFO_FIELDS = ["use_responses_lite"];

const LIME_RESPONSES_POLICY_INPUT_FIELDS = [
  "use_responses_lite",
  "useResponsesLite",
];

const LIME_RESPONSES_POLICY_FIELDS = [
  "use_responses_lite",
  "request_mode",
  "instructions_location",
  "tools_location",
  "reasoning_context",
  "parallel_tool_calls_allowed",
  "requires_responses_lite_header",
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
    new RegExp(`export interface ${name} \\{\\n(?<body>[\\s\\S]*?)\\n\\}`, "u"),
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

describe("Codex model responses policy origin", () => {
  it("ModelResponsesPolicyInput 只接收 Codex ModelInfo use_responses_lite 字段", () => {
    const limeSource = readRepoFile(LIME_RESPONSES_POLICY_SOURCE);

    expect(
      extractTypeFieldNames(limeSource, "ModelResponsesPolicyInput"),
    ).toEqual(LIME_RESPONSES_POLICY_INPUT_FIELDS);
    expect(extractTypeFieldNames(limeSource, "ModelResponsesPolicy")).toEqual(
      LIME_RESPONSES_POLICY_FIELDS,
    );

    const upstreamOpenaiModelsSource = readIfExists(
      UPSTREAM_OPENAI_MODELS_SOURCE,
    );
    if (!upstreamOpenaiModelsSource) {
      return;
    }

    const upstreamModelInfoFields = extractRustPubFieldNames(
      upstreamOpenaiModelsSource,
      "ModelInfo",
    );
    expect(
      upstreamModelInfoFields.filter((field) =>
        UPSTREAM_RESPONSES_POLICY_MODEL_INFO_FIELDS.includes(field),
      ),
    ).toEqual(UPSTREAM_RESPONSES_POLICY_MODEL_INFO_FIELDS);
  });

  it("Responses Lite request mode 沿用 Codex header、metadata、reasoning context 与 payload shape 语义", () => {
    const limeSource = readRepoFile(LIME_RESPONSES_POLICY_SOURCE);

    expect(limeSource).toContain(
      'request_mode: useResponsesLite ? "responses_lite" : "responses"',
    );
    expect(limeSource).toContain(
      'instructions_location: useResponsesLite ? "input_prefix" : "request_field"',
    );
    expect(limeSource).toContain(
      'tools_location: useResponsesLite ? "input_prefix" : "request_field"',
    );
    expect(limeSource).toContain(
      'reasoning_context: useResponsesLite ? "all_turns" : "default"',
    );
    expect(limeSource).toContain(
      "parallel_tool_calls_allowed: !useResponsesLite",
    );
    expect(limeSource).toContain(
      "requires_responses_lite_header: useResponsesLite",
    );

    const upstreamClientSource = readIfExists(UPSTREAM_CLIENT_SOURCE);
    if (!upstreamClientSource) {
      return;
    }

    expect(upstreamClientSource).toContain(
      "add_responses_lite_header(&mut headers, use_responses_lite)",
    );
    expect(upstreamClientSource).toMatch(
      /build_responses_options\(\s*turn_state,\s*responses_metadata,\s*compression,\s*model_info\.use_responses_lite,\s*\)\s*\.await/u,
    );
    expect(upstreamClientSource).toMatch(
      /async fn build_responses_options\(\s*&self,\s*turn_state: &Arc<OnceLock<String>>,\s*responses_metadata: &CodexResponsesMetadata,\s*compression: Compression,\s*use_responses_lite: bool,/u,
    );
    expect(upstreamClientSource).toMatch(
      /fn add_responses_lite_header\(headers: &mut ApiHeaderMap, use_responses_lite: bool\)\s*\{\s*if use_responses_lite\s*\{\s*headers\.insert\(\s*X_OPENAI_INTERNAL_CODEX_RESPONSES_LITE_HEADER,/u,
    );
    expect(upstreamClientSource).toMatch(
      /build_ws_client_metadata\(\s*responses_metadata,\s*include_internal,\s*model_info\.use_responses_lite,\s*\)/u,
    );
    expect(upstreamClientSource).toMatch(
      /context:\s*model_info\s*\.use_responses_lite\s*\.then_some\(ReasoningContext::AllTurns\)/u,
    );
    expect(upstreamClientSource).toContain(
      "prompt.get_formatted_input_for_request(model_info)",
    );
    expect(upstreamClientSource).toContain("if model_info.use_responses_lite");
    expect(upstreamClientSource).toContain(
      "parallel_tool_calls: prompt.parallel_tool_calls && !model_info.use_responses_lite",
    );
    expect(upstreamClientSource).toContain(
      "X_OPENAI_INTERNAL_CODEX_RESPONSES_LITE_HEADER",
    );
  });
});
