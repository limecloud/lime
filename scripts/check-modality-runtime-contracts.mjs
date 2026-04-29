#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CONTRACT_PATH = "src/lib/governance/modalityRuntimeContracts.json";
const CAPABILITY_MATRIX_PATH =
  "src/lib/governance/modalityCapabilityMatrix.json";
const REQUIRED_DOCS = [
  "docs/roadmap/warp/runtime-fact-map.md",
  "docs/roadmap/warp/contract-schema.md",
  "docs/roadmap/warp/capability-matrix.md",
  "docs/roadmap/warp/evolution-guide.md",
];

const LIFECYCLES = new Set(["current", "compat", "deprecated", "dead"]);
const MODALITIES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "browser",
  "document",
  "code",
  "mixed",
]);
const CAPABILITY_GROUPS = new Set(["model", "tool", "runtime", "policy"]);
const PERMISSIONS = new Set([
  "read_files",
  "write_artifacts",
  "execute_commands",
  "call_mcp",
  "web_search",
  "browser_control",
  "media_upload",
  "service_api_call",
  "local_cli",
  "ask_user_question",
]);
const ARTIFACT_KINDS = new Set([
  "image_task",
  "image_output",
  "audio_task",
  "audio_output",
  "transcript",
  "browser_session",
  "browser_snapshot",
  "pdf_extract",
  "report_document",
  "presentation_document",
  "webpage_artifact",
  "generic_file",
]);
const VIEWER_SURFACES = new Set([
  "image_workbench",
  "audio_player",
  "transcript_viewer",
  "browser_replay_viewer",
  "document_viewer",
  "report_viewer",
  "presentation_viewer",
  "webpage_viewer",
  "generic_file_viewer",
]);
const EVIDENCE_EVENTS = new Set([
  "candidate_set_resolved",
  "runtime_identity_bound",
  "routing_decision_made",
  "routing_not_possible",
  "single_candidate_capability_gap",
  "model_routing_decision",
  "execution_profile_decision",
  "executor_invoked",
  "artifact_written",
  "browser_action_requested",
  "browser_observation_recorded",
  "file_read_authorized",
  "web_search_performed",
]);
const LIMECORE_POLICY_REFS = new Set([
  "client_skills",
  "client_scenes",
  "model_catalog",
  "provider_offer",
  "gateway_policy",
  "scene_policy",
  "tenant_feature_flags",
  "audit_config",
]);
const EXECUTOR_KINDS = new Set([
  "skill",
  "tool",
  "service_skill",
  "browser",
  "gateway",
  "scene_cloud",
  "local_cli",
]);
const FAILURE_REASONS = new Set([
  "permission_denied",
  "capability_gap",
  "executor_error",
  "observation_unavailable",
  "file_unavailable",
  "source_unavailable",
]);
const ENTRY_KINDS = new Set([
  "command",
  "button_action",
  "scene",
  "implicit_context",
]);
const FORBIDDEN_ENTRY_FIELDS = new Set([
  "truth_source",
  "artifact_kinds",
  "viewer_surface",
  "evidence_events",
  "executor_binding",
  "routing_slot",
]);

function collectUniqueObjects(errors, collection, keyName, label) {
  const result = new Map();
  pushIf(errors, !isNonEmptyArray(collection), `${label} must be a non-empty array`);
  if (!Array.isArray(collection)) {
    return result;
  }

  collection.forEach((item, index) => {
    const prefix = `${label}[${index}]`;
    pushIf(errors, !isPlainObject(item), `${prefix} must be an object`);
    if (!isPlainObject(item)) {
      return;
    }

    const key = item[keyName];
    pushIf(
      errors,
      !isNonEmptyString(key),
      `${prefix}.${keyName} must be a non-empty string`,
    );
    if (!isNonEmptyString(key)) {
      return;
    }
    pushIf(errors, result.has(key), `${prefix}.${keyName} is duplicated: ${key}`);
    result.set(key, item);
  });

  return result;
}

function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function pushIf(errors, condition, message) {
  if (condition) {
    errors.push(message);
  }
}

function validateEnumArray(errors, contractKey, fieldName, values, allowedValues) {
  pushIf(
    errors,
    !isNonEmptyArray(values),
    `${contractKey}.${fieldName} must be a non-empty array`,
  );
  if (!Array.isArray(values)) {
    return;
  }

  for (const value of values) {
    pushIf(
      errors,
      !allowedValues.has(value),
      `${contractKey}.${fieldName} contains unknown value: ${String(value)}`,
    );
  }
}

function validateStringArray(errors, contractKey, fieldName, values, options = {}) {
  const { allowEmpty = false } = options;
  const invalidArray = allowEmpty ? !Array.isArray(values) : !isNonEmptyArray(values);
  pushIf(
    errors,
    invalidArray,
    `${contractKey}.${fieldName} must be ${allowEmpty ? "an array" : "a non-empty array"}`,
  );
  if (!Array.isArray(values)) {
    return;
  }
  values.forEach((value, index) => {
    pushIf(
      errors,
      !isNonEmptyString(value),
      `${contractKey}.${fieldName}[${index}] must be a non-empty string`,
    );
  });
}

function looksLikeEntryKey(contractKey) {
  return (
    contractKey.startsWith("@") ||
    contractKey.startsWith("/") ||
    contractKey.startsWith("at_") ||
    contractKey.includes("@") ||
    /[\u4e00-\u9fff]/u.test(contractKey)
  );
}

function validateExecutor(errors, contract) {
  const contractKey = contract.contract_key;
  const executor = contract.executor_binding;
  pushIf(
    errors,
    !isPlainObject(executor),
    `${contractKey}.executor_binding must be an object`,
  );
  if (!isPlainObject(executor)) {
    return;
  }

  pushIf(
    errors,
    !EXECUTOR_KINDS.has(executor.executor_kind),
    `${contractKey}.executor_binding.executor_kind is unknown: ${String(executor.executor_kind)}`,
  );
  for (const fieldName of ["binding_key", "current_path"]) {
    pushIf(
      errors,
      !isNonEmptyString(executor[fieldName]),
      `${contractKey}.executor_binding.${fieldName} must be a non-empty string`,
    );
  }
  for (const fieldName of [
    "supports_progress",
    "supports_cancel",
    "supports_resume",
    "supports_artifact",
  ]) {
    pushIf(
      errors,
      typeof executor[fieldName] !== "boolean",
      `${contractKey}.executor_binding.${fieldName} must be boolean`,
    );
  }
  validateEnumArray(
    errors,
    contractKey,
    "executor_binding.failure_mapping",
    executor.failure_mapping,
    FAILURE_REASONS,
  );
}

function validateEntryBindings(errors, contract) {
  const contractKey = contract.contract_key;
  pushIf(
    errors,
    !Array.isArray(contract.bound_entries),
    `${contractKey}.bound_entries must be an array`,
  );
  if (!Array.isArray(contract.bound_entries)) {
    return;
  }

  contract.bound_entries.forEach((entry, index) => {
    const prefix = `${contractKey}.bound_entries[${index}]`;
    pushIf(errors, !isPlainObject(entry), `${prefix} must be an object`);
    if (!isPlainObject(entry)) {
      return;
    }
    for (const fieldName of [
      "entry_key",
      "display_name",
      "launch_metadata_path",
    ]) {
      pushIf(
        errors,
        !isNonEmptyString(entry[fieldName]),
        `${prefix}.${fieldName} must be a non-empty string`,
      );
    }
    pushIf(
      errors,
      !ENTRY_KINDS.has(entry.entry_kind),
      `${prefix}.entry_kind is unknown: ${String(entry.entry_kind)}`,
    );
    validateStringArray(
      errors,
      contractKey,
      `bound_entries[${index}].default_input_mapping`,
      entry.default_input_mapping,
    );
    validateStringArray(
      errors,
      contractKey,
      `bound_entries[${index}].entry_visibility_policy`,
      entry.entry_visibility_policy,
    );

    for (const fieldName of Object.keys(entry)) {
      pushIf(
        errors,
        FORBIDDEN_ENTRY_FIELDS.has(fieldName),
        `${prefix}.${fieldName} is a bottom-layer field and must stay on the contract`,
      );
    }
  });
}

function validateCapabilityMatrix(matrix) {
  const errors = [];
  pushIf(errors, matrix.version !== 1, "capabilityMatrix.version must be 1");
  pushIf(
    errors,
    matrix.status !== "current",
    "capabilityMatrix.status must be current",
  );
  pushIf(
    errors,
    !isNonEmptyString(matrix.owner),
    "capabilityMatrix.owner must be set",
  );

  const capabilityMap = collectUniqueObjects(
    errors,
    matrix.capabilities,
    "key",
    "capabilityMatrix.capabilities",
  );
  const modelRoleMap = collectUniqueObjects(
    errors,
    matrix.model_roles,
    "slot",
    "capabilityMatrix.model_roles",
  );

  for (const [key, capability] of capabilityMap.entries()) {
    pushIf(
      errors,
      !LIFECYCLES.has(capability.lifecycle),
      `capability ${key}.lifecycle is unknown: ${String(capability.lifecycle)}`,
    );
    pushIf(
      errors,
      !CAPABILITY_GROUPS.has(capability.group),
      `capability ${key}.group is unknown: ${String(capability.group)}`,
    );
    pushIf(
      errors,
      !isNonEmptyString(capability.description),
      `capability ${key}.description must be set`,
    );
    validateStringArray(
      errors,
      key,
      "routing_sources",
      capability.routing_sources,
    );
    pushIf(
      errors,
      !isNonEmptyString(capability.capability_gap_code),
      `capability ${key}.capability_gap_code must be set`,
    );
    validateEnumArray(
      errors,
      key,
      "evidence_events",
      capability.evidence_events,
      EVIDENCE_EVENTS,
    );
  }

  for (const [slot, role] of modelRoleMap.entries()) {
    pushIf(
      errors,
      !LIFECYCLES.has(role.lifecycle),
      `model role ${slot}.lifecycle is unknown: ${String(role.lifecycle)}`,
    );
    validateEnumArray(
      errors,
      slot,
      "capability_keys",
      role.capability_keys,
      new Set(capabilityMap.keys()),
    );
    validateStringArray(
      errors,
      slot,
      "fallback_slots",
      role.fallback_slots,
      { allowEmpty: true },
    );
    if (Array.isArray(role.fallback_slots)) {
      for (const fallbackSlot of role.fallback_slots) {
        pushIf(
          errors,
          !modelRoleMap.has(fallbackSlot),
          `model role ${slot}.fallback_slots contains unknown slot: ${fallbackSlot}`,
        );
      }
    }
  }

  return {
    errors,
    capabilityKeys: new Set(capabilityMap.keys()),
    modelRoleSlots: new Set(modelRoleMap.keys()),
  };
}

function validateContractRegistry(registry, matrixRefs) {
  const errors = [];
  pushIf(errors, registry.version !== 1, "registry.version must be 1");
  pushIf(errors, registry.status !== "current", "registry.status must be current");
  pushIf(errors, !isNonEmptyString(registry.owner), "registry.owner must be set");
  pushIf(errors, !isNonEmptyArray(registry.contracts), "registry.contracts must be a non-empty array");
  if (!Array.isArray(registry.contracts)) {
    return errors;
  }

  const contractKeys = new Set();
  for (const contract of registry.contracts) {
    const contractKey = contract?.contract_key ?? "<missing>";
    pushIf(errors, !isPlainObject(contract), "each contract must be an object");
    if (!isPlainObject(contract)) {
      continue;
    }

    pushIf(
      errors,
      !isNonEmptyString(contract.contract_key),
      "contract.contract_key must be a non-empty string",
    );
    pushIf(
      errors,
      isNonEmptyString(contract.contract_key) && looksLikeEntryKey(contract.contract_key),
      `${contractKey}.contract_key must be a bottom-layer key, not an entry key`,
    );
    pushIf(
      errors,
      contractKeys.has(contract.contract_key),
      `${contractKey}.contract_key is duplicated`,
    );
    contractKeys.add(contract.contract_key);

    pushIf(
      errors,
      !LIFECYCLES.has(contract.lifecycle),
      `${contractKey}.lifecycle is unknown: ${String(contract.lifecycle)}`,
    );
    pushIf(
      errors,
      !MODALITIES.has(contract.modality),
      `${contractKey}.modality is unknown: ${String(contract.modality)}`,
    );
    validateStringArray(errors, contractKey, "runtime_identity", contract.runtime_identity);
    validateStringArray(errors, contractKey, "input_context_kinds", contract.input_context_kinds);
    validateEnumArray(
      errors,
      contractKey,
      "required_capabilities",
      contract.required_capabilities,
      matrixRefs.capabilityKeys,
    );
    validateEnumArray(errors, contractKey, "permission_profile_keys", contract.permission_profile_keys, PERMISSIONS);
    pushIf(errors, !isNonEmptyString(contract.routing_slot), `${contractKey}.routing_slot must be set`);
    pushIf(
      errors,
      isNonEmptyString(contract.routing_slot) &&
        !matrixRefs.modelRoleSlots.has(contract.routing_slot),
      `${contractKey}.routing_slot is not defined in capability matrix: ${String(contract.routing_slot)}`,
    );
    validateExecutor(errors, contract);
    validateStringArray(errors, contractKey, "truth_source", contract.truth_source);
    validateEnumArray(errors, contractKey, "artifact_kinds", contract.artifact_kinds, ARTIFACT_KINDS);
    validateEnumArray(errors, contractKey, "viewer_surface", contract.viewer_surface, VIEWER_SURFACES);
    validateEnumArray(errors, contractKey, "evidence_events", contract.evidence_events, EVIDENCE_EVENTS);
    validateEnumArray(errors, contractKey, "limecore_policy_refs", contract.limecore_policy_refs, LIMECORE_POLICY_REFS);
    validateStringArray(errors, contractKey, "fallback_policy", contract.fallback_policy);

    pushIf(errors, !isPlainObject(contract.detour_policy), `${contractKey}.detour_policy must be an object`);
    if (isPlainObject(contract.detour_policy)) {
      validateStringArray(errors, contractKey, "detour_policy.allowed", contract.detour_policy.allowed, { allowEmpty: true });
      validateStringArray(errors, contractKey, "detour_policy.denied", contract.detour_policy.denied);
    }
    pushIf(errors, !isNonEmptyString(contract.owner_surface), `${contractKey}.owner_surface must be set`);
    validateEntryBindings(errors, contract);
  }

  return errors;
}

function validateRequiredDocs() {
  return REQUIRED_DOCS.flatMap((docPath) => {
    const absolutePath = path.resolve(process.cwd(), docPath);
    if (fs.existsSync(absolutePath)) {
      return [];
    }
    return [`required roadmap document is missing: ${docPath}`];
  });
}

function renderSuccess(registry, matrix) {
  const currentCount = registry.contracts.filter(
    (contract) => contract.lifecycle === "current",
  ).length;
  return [
    "[lime] modality runtime contracts OK",
    `  contracts: ${registry.contracts.length}`,
    `  current: ${currentCount}`,
    `  capabilities: ${matrix.capabilities.length}`,
    `  model roles: ${matrix.model_roles.length}`,
    `  registry: ${CONTRACT_PATH}`,
    `  matrix: ${CAPABILITY_MATRIX_PATH}`,
  ].join("\n");
}

function main() {
  const registry = readJson(CONTRACT_PATH);
  const matrix = readJson(CAPABILITY_MATRIX_PATH);
  const matrixReport = validateCapabilityMatrix(matrix);
  const errors = [
    ...validateRequiredDocs(),
    ...matrixReport.errors,
    ...validateContractRegistry(registry, matrixReport),
  ];

  if (errors.length > 0) {
    console.error("[lime] modality runtime contracts FAILED");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(renderSuccess(registry, matrix));
}

main();
