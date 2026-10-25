import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  normalizeProjectionIdList,
  readBooleanField,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiSelectedCapabilityStackIssueCode =
  | "missing_selected_root"
  | "selected_root_missing_environment"
  | "selected_root_missing_path"
  | "missing_environment_state"
  | "unavailable_sample_injected_capability"
  | "available_sample_missing_capability_update"
  | "resume_reused_available_generation"
  | "availability_change_without_generation"
  | "same_turn_availability_not_resampled"
  | "history_sample_rewritten";

export interface AgentUiSelectedCapabilityStackIssue {
  code: AgentUiSelectedCapabilityStackIssueCode;
  path: string;
  message: string;
}

export interface AgentUiSelectedCapabilityStackProjectionInput {
  threadId?: string | null;
  turnId?: string | null;
  resumeSessionId?: string | null;
  resumed?: boolean | null;
  selectedCapabilityRoots?: unknown;
  environmentStates?: unknown;
  environments?: unknown;
  samples?: unknown;
  requests?: unknown;
  previousSamples?: unknown;
  availabilityTimeline?: unknown;
  timestamp?: string | null;
}

export interface AgentUiSelectedCapabilityRootSnapshot {
  id: string;
  environmentId?: string;
  path?: string;
  locationType?: string;
}

export interface AgentUiSelectedEnvironmentStateSnapshot {
  environmentId: string;
  available: boolean;
  generation?: string;
  source?: string;
}

export interface AgentUiSelectedCapabilitySampleSnapshot {
  sampleId: string;
  turnId?: string;
  phase?: string;
  environmentId?: string;
  environmentGeneration?: string;
  environmentAvailable: boolean;
  selectedRootIds: string[];
  selectedSkillNames: string[];
  selectedMcpServerNames: string[];
  selectedPluginToolNames: string[];
  unavailableMessage?: string;
  resumed: boolean;
}

export interface AgentUiSelectedCapabilityAvailabilitySnapshot {
  environmentId: string;
  available: boolean;
  generation?: string;
  turnId?: string;
  sampleId?: string;
  source?: string;
}

export interface AgentUiSelectedCapabilityStackSnapshot {
  threadId?: string;
  turnId?: string;
  resumeSessionId?: string;
  resumed: boolean;
  selectedRootIds: string[];
  selectedRoots: AgentUiSelectedCapabilityRootSnapshot[];
  environmentStates: AgentUiSelectedEnvironmentStateSnapshot[];
  samples: AgentUiSelectedCapabilitySampleSnapshot[];
  availabilityTimeline: AgentUiSelectedCapabilityAvailabilitySnapshot[];
  availableEnvironmentIds: string[];
  unavailableEnvironmentIds: string[];
  historyStable: boolean;
  injectionStable: boolean;
  validationIssues: AgentUiSelectedCapabilityStackIssue[];
}

function issue(
  code: AgentUiSelectedCapabilityStackIssueCode,
  path: string,
  message: string,
): AgentUiSelectedCapabilityStackIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function readGeneration(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return definedString(value);
  return undefined;
}

function readNameList(value: unknown): string[] {
  if (typeof value === "string") return normalizeProjectionIdList([value]);
  if (!Array.isArray(value)) return [];
  return normalizeProjectionIdList(
    value.map((item) => {
      if (typeof item === "string") return item;
      const record = readRecord(item);
      return readStringField(record, ["name", "id", "server", "tool"]);
    }),
  );
}

function readRootIds(value: unknown): string[] {
  if (typeof value === "string") return normalizeProjectionIdList([value]);
  if (!Array.isArray(value)) return [];
  return normalizeProjectionIdList(
    value.map((item) => {
      if (typeof item === "string") return item;
      const record = readRecord(item);
      return readStringField(record, [
        "id",
        "selectedRootId",
        "selected_root_id",
      ]);
    }),
  );
}

function normalizePath(value: string | undefined): string | undefined {
  const trimmed = definedString(value);
  if (!trimmed) return undefined;
  return trimmed
    .replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
}

function selectedRootsForInput(
  input: AgentUiSelectedCapabilityStackProjectionInput,
): AgentUiSelectedCapabilityRootSnapshot[] {
  const roots: AgentUiSelectedCapabilityRootSnapshot[] = [];
  for (const record of recordArray(input.selectedCapabilityRoots)) {
    const id = readStringField(record, [
      "id",
      "selectedRootId",
      "selected_root_id",
    ]);
    const location = readRecord(record.location) ?? record;
    if (!id) continue;
    roots.push(
      compactProjectionFields({
        id,
        environmentId: readStringField(location, [
          "environmentId",
          "environment_id",
        ]),
        path: normalizePath(readStringField(location, ["path", "uri"])),
        locationType: readStringField(location, [
          "type",
          "locationType",
          "location_type",
        ]),
      } satisfies AgentUiSelectedCapabilityRootSnapshot),
    );
  }
  return roots;
}

function environmentStatesForInput(
  input: AgentUiSelectedCapabilityStackProjectionInput,
): AgentUiSelectedEnvironmentStateSnapshot[] {
  const states: AgentUiSelectedEnvironmentStateSnapshot[] = [];
  for (const record of [
    ...recordArray(input.environmentStates),
    ...recordArray(input.environments),
  ]) {
    const environmentId = readStringField(record, [
      "environmentId",
      "environment_id",
      "id",
    ]);
    if (!environmentId) continue;
    states.push(
      compactProjectionFields({
        environmentId,
        available:
          readBooleanField(record, [
            "available",
            "enabled",
            "connected",
            "reachable",
          ]) ?? false,
        generation: readGeneration(record.generation ?? record.version),
        source: readStringField(record, ["source", "phase"]),
      } satisfies AgentUiSelectedEnvironmentStateSnapshot),
    );
  }
  return states;
}

function latestState(
  states: readonly AgentUiSelectedEnvironmentStateSnapshot[],
  environmentId: string | undefined,
  generation: string | undefined,
): AgentUiSelectedEnvironmentStateSnapshot | undefined {
  if (!environmentId) return undefined;
  if (generation) {
    return states.find(
      (state) =>
        state.environmentId === environmentId &&
        state.generation === generation,
    );
  }
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    if (state.environmentId === environmentId) return state;
  }
  return undefined;
}

function firstNonEmptyList(...values: unknown[]): string[] {
  for (const value of values) {
    const ids = readRootIds(value);
    if (ids.length > 0) return ids;
  }
  return [];
}

function sampleRecords(
  input: AgentUiSelectedCapabilityStackProjectionInput,
): Record<string, unknown>[] {
  return [...recordArray(input.samples), ...recordArray(input.requests)];
}

function buildSample(
  record: Record<string, unknown>,
  index: number,
  input: AgentUiSelectedCapabilityStackProjectionInput,
  roots: readonly AgentUiSelectedCapabilityRootSnapshot[],
  states: readonly AgentUiSelectedEnvironmentStateSnapshot[],
): AgentUiSelectedCapabilitySampleSnapshot {
  const rootIds = firstNonEmptyList(
    record.selectedRootIds,
    record.selected_root_ids,
    record.selectedRoots,
    record.selected_roots,
  );
  const environmentId =
    readStringField(record, ["environmentId", "environment_id"]) ??
    roots.find((root) => rootIds.includes(root.id))?.environmentId ??
    roots[0]?.environmentId;
  const generation = readGeneration(
    record.environmentGeneration ??
      record.environment_generation ??
      record.generation,
  );
  const state = latestState(states, environmentId, generation);
  const explicitAvailable = readBooleanField(record, [
    "environmentAvailable",
    "environment_available",
    "available",
  ]);
  return compactProjectionFields({
    sampleId:
      readStringField(record, [
        "sampleId",
        "sample_id",
        "requestId",
        "request_id",
        "id",
      ]) ?? `sample-${index + 1}`,
    turnId:
      readStringField(record, ["turnId", "turn_id"]) ??
      input.turnId ??
      undefined,
    phase: readStringField(record, ["phase", "stage"]),
    environmentId,
    environmentGeneration: generation ?? state?.generation,
    environmentAvailable: explicitAvailable ?? state?.available ?? false,
    selectedRootIds:
      rootIds.length > 0 ? rootIds : roots.map((root) => root.id),
    selectedSkillNames: readNameList(
      record.selectedSkills ?? record.selected_skill_names,
    ),
    selectedMcpServerNames: readNameList(
      record.selectedMcpServers ?? record.selected_mcp_server_names,
    ),
    selectedPluginToolNames: readNameList(
      record.selectedPluginTools ?? record.selected_plugin_tool_names,
    ),
    unavailableMessage: readStringField(record, [
      "unavailableMessage",
      "unavailable_message",
      "message",
    ]),
    resumed:
      readBooleanField(record, ["resumed", "resume"]) ??
      Boolean(input.resumed || input.resumeSessionId),
  } satisfies AgentUiSelectedCapabilitySampleSnapshot);
}

function timelineForInput(
  input: AgentUiSelectedCapabilityStackProjectionInput,
  states: readonly AgentUiSelectedEnvironmentStateSnapshot[],
): AgentUiSelectedCapabilityAvailabilitySnapshot[] {
  const explicit = recordArray(input.availabilityTimeline);
  if (explicit.length === 0) {
    return states.map((state) =>
      compactProjectionFields({
        environmentId: state.environmentId,
        available: state.available,
        generation: state.generation,
        source: state.source,
      } satisfies AgentUiSelectedCapabilityAvailabilitySnapshot),
    );
  }

  const timeline: AgentUiSelectedCapabilityAvailabilitySnapshot[] = [];
  for (const record of explicit) {
    const environmentId = readStringField(record, [
      "environmentId",
      "environment_id",
      "id",
    ]);
    if (!environmentId) continue;
    timeline.push(
      compactProjectionFields({
        environmentId,
        available:
          readBooleanField(record, [
            "available",
            "enabled",
            "connected",
            "reachable",
          ]) ?? false,
        generation: readGeneration(record.generation ?? record.version),
        turnId: readStringField(record, ["turnId", "turn_id"]),
        sampleId: readStringField(record, ["sampleId", "sample_id"]),
        source: readStringField(record, ["source", "phase"]),
      } satisfies AgentUiSelectedCapabilityAvailabilitySnapshot),
    );
  }
  return timeline;
}

function hasCapabilityInjection(
  sample: AgentUiSelectedCapabilitySampleSnapshot,
): boolean {
  return (
    sample.selectedSkillNames.length > 0 ||
    sample.selectedMcpServerNames.length > 0 ||
    sample.selectedPluginToolNames.length > 0
  );
}

function sampleSignature(
  sample: AgentUiSelectedCapabilitySampleSnapshot,
): string {
  return JSON.stringify({
    environmentAvailable: sample.environmentAvailable,
    environmentGeneration: sample.environmentGeneration,
    selectedSkillNames: sample.selectedSkillNames,
    selectedMcpServerNames: sample.selectedMcpServerNames,
    selectedPluginToolNames: sample.selectedPluginToolNames,
  });
}

function validateHistory(
  input: AgentUiSelectedCapabilityStackProjectionInput,
  currentSamples: readonly AgentUiSelectedCapabilitySampleSnapshot[],
): AgentUiSelectedCapabilityStackIssue[] {
  const issues: AgentUiSelectedCapabilityStackIssue[] = [];
  const previous = sampleRecords({ samples: input.previousSamples }).map(
    (record, index) => buildSample(record, index, input, [], []),
  );
  const currentById = new Map(
    currentSamples.map((sample) => [sample.sampleId, sample]),
  );
  previous.forEach((sample, index) => {
    const current = currentById.get(sample.sampleId);
    if (current && sampleSignature(current) !== sampleSignature(sample)) {
      issues.push(
        issue(
          "history_sample_rewritten",
          `$.previousSamples[${index}]`,
          "Availability changes must not rewrite already-sent samples.",
        ),
      );
    }
  });
  return issues;
}

function validateSnapshot(
  input: AgentUiSelectedCapabilityStackProjectionInput,
  snapshot: Omit<
    AgentUiSelectedCapabilityStackSnapshot,
    "historyStable" | "injectionStable" | "validationIssues"
  >,
): AgentUiSelectedCapabilityStackIssue[] {
  const issues: AgentUiSelectedCapabilityStackIssue[] = [];
  const stateKeys = new Set(
    snapshot.environmentStates.map((state) => state.environmentId),
  );
  const availableGenerations = new Set(
    snapshot.environmentStates
      .filter((state) => state.available && state.generation)
      .map((state) => `${state.environmentId}:${state.generation}`),
  );

  if (snapshot.selectedRoots.length === 0) {
    issues.push(
      issue(
        "missing_selected_root",
        "$.selectedCapabilityRoots",
        "Selected capability stack requires at least one selected root.",
      ),
    );
  }

  snapshot.selectedRoots.forEach((root, index) => {
    if (!root.environmentId) {
      issues.push(
        issue(
          "selected_root_missing_environment",
          `$.selectedCapabilityRoots[${index}].location.environmentId`,
          "Selected roots must bind to an environment id.",
        ),
      );
    } else if (!stateKeys.has(root.environmentId)) {
      issues.push(
        issue(
          "missing_environment_state",
          `$.environmentStates[${root.environmentId}]`,
          "Selected root environment availability must be present in the stack snapshot.",
        ),
      );
    }
    if (!root.path) {
      issues.push(
        issue(
          "selected_root_missing_path",
          `$.selectedCapabilityRoots[${index}].location.path`,
          "Selected roots must preserve their environment path.",
        ),
      );
    }
  });

  const timelineByEnvironment = new Map<
    string,
    AgentUiSelectedCapabilityAvailabilitySnapshot[]
  >();
  snapshot.availabilityTimeline.forEach((entry, index) => {
    const entries = timelineByEnvironment.get(entry.environmentId) ?? [];
    entries.push(entry);
    timelineByEnvironment.set(entry.environmentId, entries);
    if (!entry.generation && entries.length > 0) {
      issues.push(
        issue(
          "availability_change_without_generation",
          `$.availabilityTimeline[${index}].generation`,
          "Availability changes must carry a generation so old requests are not rewritten.",
        ),
      );
    }
  });

  snapshot.samples.forEach((sample, index) => {
    if (snapshot.selectedRoots.length > 0 && !sample.environmentId) {
      issues.push(
        issue(
          "missing_environment_state",
          `$.samples[${index}].environmentId`,
          "Selected capability request samples must record the environment they observed.",
        ),
      );
    }
    if (!sample.environmentAvailable && hasCapabilityInjection(sample)) {
      issues.push(
        issue(
          "unavailable_sample_injected_capability",
          `$.samples[${index}]`,
          "Unavailable selected environments must not inject selected skills, MCP servers or plugin tools.",
        ),
      );
    }
    if (sample.environmentAvailable && !hasCapabilityInjection(sample)) {
      issues.push(
        issue(
          "available_sample_missing_capability_update",
          `$.samples[${index}]`,
          "Available selected environments must update the request with selected capability tools.",
        ),
      );
    }
    if (
      sample.resumed &&
      !sample.environmentAvailable &&
      sample.environmentId &&
      sample.environmentGeneration &&
      availableGenerations.has(
        `${sample.environmentId}:${sample.environmentGeneration}`,
      )
    ) {
      issues.push(
        issue(
          "resume_reused_available_generation",
          `$.samples[${index}].environmentGeneration`,
          "Resume must not reuse a stale available generation when the selected environment is unavailable.",
        ),
      );
    }
  });

  for (const entries of timelineByEnvironment.values()) {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (
        previous.available === false &&
        current.available === true &&
        current.turnId &&
        !snapshot.samples.some(
          (sample) =>
            sample.turnId === current.turnId &&
            sample.environmentId === current.environmentId &&
            sample.environmentAvailable &&
            (!current.generation ||
              sample.environmentGeneration === current.generation),
        )
      ) {
        issues.push(
          issue(
            "same_turn_availability_not_resampled",
            "$.samples",
            "When selected capabilities become available mid-turn, the next sample in that turn must see the new stack.",
          ),
        );
      }
    }
  }

  return [...issues, ...validateHistory(input, snapshot.samples)];
}

function runtimeStatus(
  issues: readonly AgentUiSelectedCapabilityStackIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractSelectedCapabilityStackSnapshot(
  input: AgentUiSelectedCapabilityStackProjectionInput,
): AgentUiSelectedCapabilityStackSnapshot {
  const roots = selectedRootsForInput(input);
  const states = environmentStatesForInput(input);
  const samples = sampleRecords(input).map((record, index) =>
    buildSample(record, index, input, roots, states),
  );
  const timeline = timelineForInput(input, states);
  const base = {
    threadId: definedString(input.threadId ?? undefined),
    turnId: definedString(input.turnId ?? undefined),
    resumeSessionId: definedString(input.resumeSessionId ?? undefined),
    resumed: Boolean(input.resumed || input.resumeSessionId),
    selectedRootIds: roots.map((root) => root.id),
    selectedRoots: roots,
    environmentStates: states,
    samples,
    availabilityTimeline: timeline,
    availableEnvironmentIds: normalizeProjectionIdList(
      states
        .filter((state) => state.available)
        .map((state) => state.environmentId),
    ),
    unavailableEnvironmentIds: normalizeProjectionIdList(
      states
        .filter((state) => !state.available)
        .map((state) => state.environmentId),
    ),
  };
  const validationIssues = validateSnapshot(input, base);
  return {
    ...base,
    historyStable: !validationIssues.some(
      (item) => item.code === "history_sample_rewritten",
    ),
    injectionStable: !validationIssues.some((item) =>
      [
        "unavailable_sample_injected_capability",
        "available_sample_missing_capability_update",
        "resume_reused_available_generation",
        "same_turn_availability_not_resampled",
      ].includes(item.code),
    ),
    validationIssues,
  };
}

export function buildSelectedCapabilityStackProjectionEvent(
  input: AgentUiSelectedCapabilityStackProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractSelectedCapabilityStackSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "selected_capability_stack_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: snapshot.turnId ?? definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      selectedCapabilityStackEvent: "availability_snapshot",
      selectedRootIds: snapshot.selectedRootIds,
      availableEnvironmentIds: snapshot.availableEnvironmentIds,
      unavailableEnvironmentIds: snapshot.unavailableEnvironmentIds,
      sampleCount: snapshot.samples.length,
      historyStable: snapshot.historyStable,
      injectionStable: snapshot.injectionStable,
      selectedCapabilityStack: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
