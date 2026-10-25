import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = cwd();
const CAPABILITY_SOURCE = "src/lib/model/inferModelCapabilities.ts";
const PROTOCOL_SOURCE =
  "lime-rs/crates/app-server-protocol/src/protocol/v0/model.rs";
const RUNTIME_ROUTE_SOURCE = "lime-rs/crates/runtime-core/src/model_route.rs";

const EXECUTION_SUMMARY_FIELDS = [
  "capabilities",
  "task_families",
  "input_modalities",
  "output_modalities",
  "runtime_features",
  "supports_tools",
  "supports_reasoning",
  "supports_prompt_cache",
  "supports_media_input",
  "supports_media_output",
  "context_length",
  "max_output_tokens",
];

const PICKER_OR_CATALOG_FIELDS = [
  "display_name",
  "provider_name",
  "tier",
  "status",
  "release_date",
  "is_latest",
  "source",
  "created_at",
  "updated_at",
  "pricing",
  "deployment_source",
  "management_plane",
  "alias_source",
];

const REGISTRY_POLICY_PROJECTION_FIELDS = [
  "execution_policy",
  "context_policy",
  "picker_policy",
  "tool_call_policy",
  "reasoning_policy",
  "reasoning_output_policy",
  "input_modality_policy",
  "responses_policy",
  "truncation_policy",
  "native_tool_policy",
];

const UPSTREAM_POLICY_WIRE_FIELDS = [
  "tool_mode",
  "supports_search_tool",
  "web_search_tool_type",
  "supports_image_detail_original",
  "context_window",
  "max_context_window",
  "auto_compact_token_limit",
  "effective_context_window_percent",
  "visibility",
  "service_tiers",
  "default_service_tier",
  "supports_parallel_tool_calls",
  "default_reasoning_level",
  "supported_reasoning_levels",
  "supports_reasoning_summaries",
  "default_reasoning_summary",
  "support_verbosity",
  "default_verbosity",
  "use_responses_lite",
  "truncation_policy",
  "shell_type",
  "apply_patch_tool_type",
  "experimental_supported_tools",
];

const SUMMARY_POLICY_FORBIDDEN_FIELDS = [
  ...REGISTRY_POLICY_PROJECTION_FIELDS,
  ...UPSTREAM_POLICY_WIRE_FIELDS,
];

const POLICY_OWNER_DEPENDENCY_TOKENS = [
  "modelExecutionPolicy",
  "modelContextPolicy",
  "modelPickerPolicy",
  "modelToolCallPolicy",
  "modelReasoningPolicy",
  "modelReasoningOutputPolicy",
  "modelInputModalityPolicy",
  "modelResponsesPolicy",
  "modelTruncationPolicy",
  "modelNativeToolPolicy",
];

const PICKER_TAXONOMY_FORBIDDEN_FIELDS = [
  "display_name",
  "provider_name",
  "tier",
  "status",
  "release_date",
  "is_latest",
  "created_at",
  "updated_at",
  "pricing",
];

const ROUTE_CAPABILITY_SNAPSHOT_FORBIDDEN_FIELDS =
  PICKER_OR_CATALOG_FIELDS.filter((field) => field !== "source");
const MODEL_TASK_REQUEST_FORBIDDEN_FIELDS =
  ROUTE_CAPABILITY_SNAPSHOT_FORBIDDEN_FIELDS;

const CAPABILITY_REQUIREMENT_FIELDS = [
  "task_families",
  "input_modalities",
  "output_modalities",
  "runtime_features",
  "capabilities",
];

const CAPABILITY_SNAPSHOT_FIELDS = [
  ...CAPABILITY_REQUIREMENT_FIELDS,
  "source",
  "reason_code",
];

const ROUTE_DEFAULTS_FIELDS = [
  "reasoning_effort",
  "prompt_cache_mode",
  "toolshim",
  "toolshim_model",
];

const RESOLVED_MODEL_ROUTE_FIELDS = [
  "model_ref",
  "protocol",
  "endpoint",
  "auth",
  "transport",
  "framing",
  "defaults",
  "capability_snapshot",
  "decision",
  "failure",
];

function readCapabilitySource(): string {
  return readRepoFile(CAPABILITY_SOURCE);
}

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function requireMatch(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  expect(match, `${label} not found`).not.toBeNull();
  return match?.groups?.body ?? match?.[1] ?? "";
}

function extractFieldNames(block: string): string[] {
  return [...block.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:,|:)/gmu)].map(
    (match) => match[1],
  );
}

function extractRustPubFieldNames(block: string): string[] {
  return [...block.matchAll(/^\s+pub\s+([a-zA-Z_][a-zA-Z0-9_]*):/gmu)].map(
    (match) => match[1],
  );
}

function rustStructBody(source: string, name: string): string {
  return requireMatch(
    source,
    new RegExp(
      `pub struct ${name} \\{\\n(?<body>[\\s\\S]*?)\\n\\}`,
      "u",
    ),
    name,
  );
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex, `${start} not found`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `${end} not found after ${start}`).toBeGreaterThanOrEqual(0);
  return source.slice(startIndex, endIndex);
}

describe("Model capability projection boundary", () => {
  it("execution summary 只暴露运行时可执行字段", () => {
    const source = readCapabilitySource();
    const summaryBlock = requireMatch(
      source,
      /export interface ModelCapabilitySummary \{\n(?<body>[\s\S]*?)\n\}/u,
      "ModelCapabilitySummary",
    );

    expect(extractFieldNames(summaryBlock)).toEqual(EXECUTION_SUMMARY_FIELDS);

    for (const field of PICKER_OR_CATALOG_FIELDS) {
      expect(
        summaryBlock,
        `ModelCapabilitySummary 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }
  });

  it("getModelCapabilitySummary 不把 picker/catalog 字段写入执行摘要", () => {
    const source = readCapabilitySource();
    const returnBlock = requireMatch(
      source,
      /export function getModelCapabilitySummary[\s\S]*?return \{\n(?<body>[\s\S]*?)\n\s{2}\};\n\}/u,
      "getModelCapabilitySummary return object",
    );

    expect(extractFieldNames(returnBlock)).toEqual(EXECUTION_SUMMARY_FIELDS);

    for (const field of PICKER_OR_CATALOG_FIELDS) {
      expect(
        returnBlock,
        `getModelCapabilitySummary return 不应写入 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }
  });

  it("capability summary 不承接 Codex policy 或 registry policy projection", () => {
    const source = readCapabilitySource();
    const summaryBlock = requireMatch(
      source,
      /export interface ModelCapabilitySummary \{\n(?<body>[\s\S]*?)\n\}/u,
      "ModelCapabilitySummary",
    );
    const returnBlock = requireMatch(
      source,
      /export function getModelCapabilitySummary[\s\S]*?return \{\n(?<body>[\s\S]*?)\n\s{2}\};\n\}/u,
      "getModelCapabilitySummary return object",
    );

    for (const field of SUMMARY_POLICY_FORBIDDEN_FIELDS) {
      expect(
        summaryBlock,
        `ModelCapabilitySummary 不应暴露 policy 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
      expect(
        returnBlock,
        `getModelCapabilitySummary return 不应写入 policy 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }

    for (const token of POLICY_OWNER_DEPENDENCY_TOKENS) {
      expect(
        source,
        `inferModelCapabilities 不应依赖 ${token}；policy 应留在独立 owner`,
      ).not.toContain(token);
    }
  });

  it("taxonomy input 不依赖模型选择器展示字段", () => {
    const source = readCapabilitySource();
    const taxonomyInputBlock = requireMatch(
      source,
      /type ModelTaxonomyInput = Pick<[\s\S]*?\n(?<body>(?:\s+\| "[^"]+"\n)+)>;/u,
      "ModelTaxonomyInput",
    );

    for (const field of PICKER_TAXONOMY_FORBIDDEN_FIELDS) {
      expect(
        taxonomyInputBlock,
        `ModelTaxonomyInput 不应 pick 模型选择器展示字段 ${field}`,
      ).not.toContain(`"${field}"`);
    }
  });

  it("App Server 协议里的 execution capability 类型不暴露 picker/catalog 字段", () => {
    const source = readRepoFile(PROTOCOL_SOURCE);
    const requirementBlock = rustStructBody(source, "CapabilityRequirement");
    const snapshotBlock = rustStructBody(source, "CapabilitySnapshot");
    const taskRequestBlock = rustStructBody(source, "ModelTaskRequest");
    const routeDefaultsBlock = rustStructBody(source, "RouteDefaults");
    const resolvedRouteBlock = rustStructBody(source, "ResolvedModelRoute");

    expect(extractRustPubFieldNames(requirementBlock)).toEqual(
      CAPABILITY_REQUIREMENT_FIELDS,
    );
    expect(extractRustPubFieldNames(snapshotBlock)).toEqual(
      CAPABILITY_SNAPSHOT_FIELDS,
    );
    expect(extractRustPubFieldNames(routeDefaultsBlock)).toEqual(
      ROUTE_DEFAULTS_FIELDS,
    );
    expect(extractRustPubFieldNames(resolvedRouteBlock)).toEqual(
      RESOLVED_MODEL_ROUTE_FIELDS,
    );
    expect(taskRequestBlock).not.toMatch(/\b(ModelInfo|ProviderInfo)\b/u);
    expect(resolvedRouteBlock).not.toMatch(/\b(ModelInfo|ProviderInfo)\b/u);

    for (const field of PICKER_OR_CATALOG_FIELDS) {
      expect(
        requirementBlock,
        `CapabilityRequirement 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }

    for (const field of ROUTE_CAPABILITY_SNAPSHOT_FORBIDDEN_FIELDS) {
      expect(
        snapshotBlock,
        `CapabilitySnapshot 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }

    for (const field of MODEL_TASK_REQUEST_FORBIDDEN_FIELDS) {
      expect(
        taskRequestBlock,
        `ModelTaskRequest 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }

    for (const field of PICKER_OR_CATALOG_FIELDS) {
      expect(
        routeDefaultsBlock,
        `RouteDefaults 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }

    for (const field of PICKER_OR_CATALOG_FIELDS) {
      expect(
        resolvedRouteBlock,
        `ResolvedModelRoute 不应暴露 picker/catalog 字段 ${field}`,
      ).not.toMatch(new RegExp(`\\b${field}\\b`, "u"));
    }
  });

  it("RuntimeCore route 构造不把 picker DTO 投影成 execution route 事实源", () => {
    const source = readRepoFile(RUNTIME_ROUTE_SOURCE);
    const resolvedRouteFromTask = sourceBetween(
      source,
      "pub fn resolved_route_from_task",
      "pub fn route_resolution_evidence_payloads",
    );

    expect(resolvedRouteFromTask).not.toMatch(/^\s{8}(model|provider):/mu);
  });
});
