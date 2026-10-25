import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = cwd();
const LIME_PICKER_POLICY_SOURCE = "src/lib/model/modelPickerPolicy.ts";
const DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE =
  "/Users/coso/Documents/dev/rust/codex/codex-rs/protocol/src/openai_models.rs";
const UPSTREAM_OPENAI_MODELS_SOURCE =
  env.UPSTREAM_OPENAI_MODELS_SOURCE ?? DEFAULT_UPSTREAM_OPENAI_MODELS_SOURCE;

const UPSTREAM_MODEL_VISIBILITY_VALUES = ["list", "hide", "none"];
const UPSTREAM_PICKER_POLICY_MODEL_INFO_FIELDS = [
  "visibility",
  "service_tiers",
  "default_service_tier",
];
const LIME_PICKER_POLICY_INPUT_FIELDS = [
  "visibility",
  "service_tiers",
  "serviceTiers",
  "default_service_tier",
  "defaultServiceTier",
];
const LIME_PICKER_POLICY_FIELDS = [
  "visibility",
  "show_in_picker",
  "service_tiers",
  "supported_service_tier_ids",
  "default_service_tier",
];

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function readCodexSource(): string | null {
  if (!existsSync(UPSTREAM_OPENAI_MODELS_SOURCE)) {
    return null;
  }
  return readFileSync(UPSTREAM_OPENAI_MODELS_SOURCE, "utf8");
}

function requireMatch(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  expect(match, `${label} not found`).not.toBeNull();
  return match?.groups?.body ?? match?.[1] ?? "";
}

function extractConstStringArray(source: string, name: string): string[] {
  const body = requireMatch(
    source,
    new RegExp(
      `export const ${name} = \\[\\n(?<body>[\\s\\S]*?)\\n\\] as const;`,
      "u",
    ),
    name,
  );
  return [...body.matchAll(/"([^"]+)"/gmu)].map((match) => match[1]);
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

function extractRustEnumWireValues(source: string, name: string): string[] {
  const body = requireMatch(
    source,
    new RegExp(`pub enum ${name} \\{\\n(?<body>[\\s\\S]*?)\\n\\}`, "u"),
    name,
  );
  return [...body.matchAll(/^\s+([A-Z][a-zA-Z0-9]*),$/gmu)].map((match) =>
    match[1].toLowerCase(),
  );
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex, `${start} not found`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `${end} not found after ${start}`).toBeGreaterThanOrEqual(0);
  return source.slice(startIndex, endIndex);
}

describe("Codex model picker policy origin", () => {
  it("Lime picker visibility 与 Codex ModelVisibility 保持一致", () => {
    const limeSource = readRepoFile(LIME_PICKER_POLICY_SOURCE);

    expect(extractConstStringArray(limeSource, "MODEL_VISIBILITIES")).toEqual(
      UPSTREAM_MODEL_VISIBILITY_VALUES,
    );

    const upstreamSource = readCodexSource();
    if (!upstreamSource) {
      return;
    }

    expect(extractRustEnumWireValues(upstreamSource, "ModelVisibility")).toEqual(
      UPSTREAM_MODEL_VISIBILITY_VALUES,
    );
  });

  it("ModelPickerPolicyInput 只接收 Codex ModelInfo picker / service tier 字段", () => {
    const limeSource = readRepoFile(LIME_PICKER_POLICY_SOURCE);

    expect(extractTypeFieldNames(limeSource, "ModelPickerPolicyInput")).toEqual(
      LIME_PICKER_POLICY_INPUT_FIELDS,
    );
    expect(extractTypeFieldNames(limeSource, "ModelPickerPolicy")).toEqual(
      LIME_PICKER_POLICY_FIELDS,
    );

    const upstreamSource = readCodexSource();
    if (!upstreamSource) {
      return;
    }

    const upstreamModelInfoFields = extractRustPubFieldNames(
      upstreamSource,
      "ModelInfo",
    );
    expect(
      upstreamModelInfoFields.filter((field) =>
        UPSTREAM_PICKER_POLICY_MODEL_INFO_FIELDS.includes(field),
      ),
    ).toEqual(UPSTREAM_PICKER_POLICY_MODEL_INFO_FIELDS);
  });

  it("show_in_picker 与 request service tier 语义沿用 Codex", () => {
    const limeSource = readRepoFile(LIME_PICKER_POLICY_SOURCE);

    expect(limeSource).toContain('show_in_picker: visibility === "list"');
    expect(limeSource).toContain(
      'serviceTier === MODEL_SERVICE_TIER_DEFAULT_REQUEST_VALUE',
    );
    expect(limeSource).toContain(
      "policy.supported_service_tier_ids.includes(serviceTier)",
    );

    const upstreamSource = readCodexSource();
    if (!upstreamSource) {
      return;
    }

    const modelPresetFromModelInfo = sourceBetween(
      upstreamSource,
      "impl From<ModelInfo> for ModelPreset",
      "impl ModelPreset {",
    );
    expect(modelPresetFromModelInfo).toContain(
      "show_in_picker: info.visibility == ModelVisibility::List",
    );

    const modelInfoServiceTier = sourceBetween(
      upstreamSource,
      "pub fn supports_service_tier(&self, service_tier: &str)",
      "impl ModelPreset {",
    );
    expect(modelInfoServiceTier).toContain("self.supports_service_tier");
    expect(modelInfoServiceTier).toContain("SERVICE_TIER_DEFAULT_REQUEST_VALUE");
  });

  it("deprecated additional_speed_tiers 不进入新的 picker policy owner", () => {
    const limeSource = readRepoFile(LIME_PICKER_POLICY_SOURCE);

    expect(limeSource).not.toContain("additional_speed_tiers");

    const upstreamSource = readCodexSource();
    if (!upstreamSource) {
      return;
    }

    expect(extractRustPubFieldNames(upstreamSource, "ModelInfo")).toContain(
      "additional_speed_tiers",
    );
  });
});
