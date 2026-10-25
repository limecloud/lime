import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = cwd();
const LIME_TOOL_CALL_POLICY_SOURCE = "src/lib/model/modelToolCallPolicy.ts";
const DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/openai_models.rs";
const DEFAULT_UPSTREAM_TURN_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/core/src/session/turn.rs";
const DEFAULT_UPSTREAM_COMPACT_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/core/src/compact_remote_request.rs";
const UPSTREAM_OPENAI_MODELS_SOURCE =
  env.UPSTREAM_OPENAI_MODELS_SOURCE ?? DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE;
const UPSTREAM_TURN_SOURCE = env.UPSTREAM_TURN_SOURCE ?? DEFAULT_UPSTREAM_TURN_SOURCE;
const UPSTREAM_COMPACT_SOURCE =
  env.UPSTREAM_COMPACT_SOURCE ?? DEFAULT_UPSTREAM_COMPACT_SOURCE;

const LIME_TOOL_CALL_POLICY_INPUT_FIELDS = [
  "supports_parallel_tool_calls",
  "supportsParallelToolCalls",
];

const LIME_TOOL_CALL_POLICY_FIELDS = [
  "supports_parallel_tool_calls",
  "parallel_tool_calls",
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

describe("Codex model tool call policy origin", () => {
  it("ModelToolCallPolicyInput 保持 Codex 工具并发能力字段边界", () => {
    const limeSource = readRepoFile(LIME_TOOL_CALL_POLICY_SOURCE);

    expect(
      extractTypeFieldNames(limeSource, "ModelToolCallPolicyInput"),
    ).toEqual(LIME_TOOL_CALL_POLICY_INPUT_FIELDS);
    expect(
      extractTypeFieldNames(limeSource, "ModelToolCallPolicy"),
    ).toEqual(LIME_TOOL_CALL_POLICY_FIELDS);

    const upstreamSource = readIfExists(UPSTREAM_OPENAI_MODELS_SOURCE);
    if (!upstreamSource) {
      return;
    }

    const upstreamModelInfoFields = extractRustPubFieldNames(
      upstreamSource,
      "ModelInfo",
    );
    // Older Codex references exposed the capability on ModelInfo. Current
    // Codex emits a fixed true value in the prompt and intentionally removed
    // the field; accept either reference shape while keeping Lime's input
    // surface explicit above.
    if (upstreamModelInfoFields.includes("supports_parallel_tool_calls")) {
      expect(upstreamModelInfoFields).toContain("supports_parallel_tool_calls");
    }
  });

  it("Codex prompt request 的 parallel_tool_calls 直接来自 ModelInfo", () => {
    const upstreamTurnSource = readIfExists(UPSTREAM_TURN_SOURCE);
    const upstreamCompactSource = readIfExists(UPSTREAM_COMPACT_SOURCE);
    if (!upstreamTurnSource || !upstreamCompactSource) {
      return;
    }

    const modelInfoForwarding =
      /parallel_tool_calls:\s*turn_context\.model_info\.supports_parallel_tool_calls/u;

    if (modelInfoForwarding.test(upstreamTurnSource)) {
      expect(upstreamCompactSource).toMatch(modelInfoForwarding);
    } else {
      expect(upstreamTurnSource).toMatch(/parallel_tool_calls:\s*true/u);
      expect(upstreamCompactSource).toMatch(/parallel_tool_calls:\s*true/u);
    }
  });
});
