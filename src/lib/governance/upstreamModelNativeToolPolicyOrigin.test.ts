import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";
import { describe, expect, it } from "vitest";
import {
  buildModelNativeToolPolicy,
  MODEL_SHELL_TOOL_TYPES,
} from "../model/modelNativeToolPolicy";

const REPO_ROOT = cwd();
const LIME_NATIVE_TOOL_POLICY_SOURCE = "src/lib/model/modelNativeToolPolicy.ts";
const DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/openai_models.rs";
const DEFAULT_UPSTREAM_SPEC_PLAN_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/core/src/tools/spec_plan.rs";
const UPSTREAM_OPENAI_MODELS_SOURCE =
  env.UPSTREAM_OPENAI_MODELS_SOURCE ?? DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE;
const UPSTREAM_SPEC_PLAN_SOURCE =
  env.UPSTREAM_SPEC_PLAN_SOURCE ?? DEFAULT_UPSTREAM_SPEC_PLAN_SOURCE;

const UPSTREAM_NATIVE_TOOL_MODEL_INFO_FIELDS = [
  "shell_type",
  "apply_patch_tool_type",
  "experimental_supported_tools",
];

const LIME_NATIVE_TOOL_POLICY_INPUT_FIELDS = [
  "shell_type",
  "shellType",
  "apply_patch_tool_type",
  "applyPatchToolType",
  "experimental_supported_tools",
  "experimentalSupportedTools",
];

const LIME_NATIVE_TOOL_POLICY_FIELDS = [
  "shell_type",
  "shell_tool_enabled",
  "preferred_shell_surface",
  "apply_patch_tool_type",
  "apply_patch_tool_enabled",
  "experimental_supported_tools",
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

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex, `${start} not found`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `${end} not found after ${start}`).toBeGreaterThanOrEqual(0);
  return source.slice(startIndex, endIndex);
}

describe("Codex model native tool policy origin", () => {
  it("ModelNativeToolPolicyInput 只接收 Codex ModelInfo native tool 字段", () => {
    const limeSource = readRepoFile(LIME_NATIVE_TOOL_POLICY_SOURCE);

    expect(
      extractTypeFieldNames(limeSource, "ModelNativeToolPolicyInput"),
    ).toEqual(LIME_NATIVE_TOOL_POLICY_INPUT_FIELDS);
    expect(extractTypeFieldNames(limeSource, "ModelNativeToolPolicy")).toEqual(
      LIME_NATIVE_TOOL_POLICY_FIELDS,
    );

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
        UPSTREAM_NATIVE_TOOL_MODEL_INFO_FIELDS.includes(field),
      ),
    ).toEqual(UPSTREAM_NATIVE_TOOL_MODEL_INFO_FIELDS);
  });

  it("shell_type 取值来自 ModelInfo，工具注册由 Codex spec_plan 承接", () => {
    expect(MODEL_SHELL_TOOL_TYPES).toEqual(["unified_exec", "disabled"]);

    const upstreamOpenaiModelsSource = readIfExists(UPSTREAM_OPENAI_MODELS_SOURCE);
    if (upstreamOpenaiModelsSource) {
      const shellType = sourceBetween(
        upstreamOpenaiModelsSource,
        "pub enum ConfigShellToolType",
        "pub enum ApplyPatchToolType",
      );
      const canonicalTypes = [...shellType.matchAll(/^\s{4}(\w+),$/gmu)].map(
        (match) => match[1].replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase(),
      );
      expect(MODEL_SHELL_TOOL_TYPES).toEqual(canonicalTypes);
      const inputAliases = [...shellType.matchAll(/alias = "([^"]+)"/gu)].map(
        (match) => match[1],
      );
      expect(inputAliases).toEqual(["default", "local", "shell_command"]);
      for (const alias of inputAliases) {
        expect(buildModelNativeToolPolicy({ shell_type: alias })).toMatchObject(
          {
            shell_type: "unified_exec",
            preferred_shell_surface: "unified_exec",
          },
        );
      }
    }

    const upstreamSpecPlanSource = readIfExists(UPSTREAM_SPEC_PLAN_SOURCE);
    if (!upstreamSpecPlanSource) {
      return;
    }

    const shellTools = sourceBetween(
      upstreamSpecPlanSource,
      "fn add_shell_tools(",
      "fn add_mcp_resource_tools(",
    );
    expect(shellTools).toContain("ConfigShellToolType::Disabled");
    expect(shellTools).toContain(
      "registry.add(ExecCommandHandler::new(options));",
    );
    expect(shellTools).toContain("registry.add(WriteStdinHandler);");
    expect(shellTools).not.toContain("ShellCommandHandler");
  });

  it("apply_patch_tool_type 与 experimental_supported_tools 沿用 Codex tool plan gate", () => {
    const limeSource = readRepoFile(LIME_NATIVE_TOOL_POLICY_SOURCE);

    expect(limeSource).toContain('MODEL_APPLY_PATCH_TOOL_TYPES = ["freeform"]');
    expect(limeSource).toContain("apply_patch_tool_enabled");
    expect(limeSource).toContain("experimental_supported_tools");
    expect(
      buildModelNativeToolPolicy({ apply_patch_tool_type: "freeform" }),
    ).toMatchObject({
      apply_patch_tool_type: "freeform",
      apply_patch_tool_enabled: true,
    });
    for (const apply_patch_tool_type of [undefined, null, "unknown"]) {
      expect(
        buildModelNativeToolPolicy({ apply_patch_tool_type }),
      ).toMatchObject({
        apply_patch_tool_type: null,
        apply_patch_tool_enabled: false,
      });
    }

    const upstreamOpenaiModelsSource = readIfExists(UPSTREAM_OPENAI_MODELS_SOURCE);
    if (upstreamOpenaiModelsSource) {
      const applyPatchToolType = sourceBetween(
        upstreamOpenaiModelsSource,
        "pub enum ApplyPatchToolType",
        "pub enum WebSearchToolType",
      );
      expect(applyPatchToolType).toContain("Freeform");
    }

    const upstreamSpecPlanSource = readIfExists(UPSTREAM_SPEC_PLAN_SOURCE);
    if (!upstreamSpecPlanSource) {
      return;
    }

    const utilityToolSource = sourceBetween(
      upstreamSpecPlanSource,
      "fn add_core_utility_tools(",
      "fn add_collaboration_tools(",
    );
    expect(utilityToolSource).toContain(
      "if context.model_info.apply_patch_tool_type.is_some() {",
    );
    expect(utilityToolSource).toContain(
      "let include_environment_id = matches!(environment_mode, ToolEnvironmentMode::Multiple);",
    );
    expect(utilityToolSource).toContain(
      "registry.add(ApplyPatchHandler::new(include_environment_id));",
    );
    expect(utilityToolSource).not.toContain("StableEnvironmentTools");
    expect(utilityToolSource).not.toContain("advertise_environment_tools");
    expect(upstreamSpecPlanSource).toContain(".experimental_supported_tools");
    expect(upstreamSpecPlanSource).toContain('tool == "test_sync_tool"');
    expect(upstreamSpecPlanSource).toContain("registry.add(TestSyncHandler);");
  });
});
