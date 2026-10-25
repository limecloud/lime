import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiStatusSurface =
  | "footer"
  | "header"
  | "title"
  | "rate_limit"
  | "model"
  | "reasoning"
  | "goal"
  | "status_preview"
  | "unknown";

export type AgentUiStatusSurfaceIssueCode =
  | "missing_status_surface"
  | "thread_session_binding_lost"
  | "presentation_owner_split"
  | "metadata_fact_missing"
  | "runtime_status_missing"
  | "rate_limit_fact_missing"
  | "natural_language_status_inference"
  | "duplicate_component_naming";

export interface AgentUiStatusSurfaceIssue {
  code: AgentUiStatusSurfaceIssueCode;
  path: string;
  message: string;
}

export interface AgentUiStatusSurfaceRowSnapshot {
  surface: AgentUiStatusSurface;
  presentationOwner?: string;
  threadId?: string;
  sessionId?: string;
  previewText?: string;
  title?: string;
  model?: string;
  reasoningEffort?: string;
  goalId?: string;
  runtimeStatus?: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
  naturalLanguageInferred: boolean;
  duplicateComponentNaming: boolean;
}

export interface AgentUiStatusSurfaceMatrixInput {
  threadId?: string;
  sessionId?: string;
  surfaces?: readonly unknown[];
  rows?: readonly unknown[];
}

export interface AgentUiStatusSurfaceMatrixProjectionSnapshot {
  surfaces: AgentUiStatusSurfaceRowSnapshot[];
  coveredSurfaces: AgentUiStatusSurface[];
  requiredSurfacesCovered: boolean;
  threadSessionBindingPreserved: boolean;
  sharedPresentationOwner: boolean;
  metadataFactsPresent: boolean;
  runtimeStatusPresent: boolean;
  rateLimitFactsPresent: boolean;
  naturalLanguageInferenceRejected: boolean;
  duplicateNamingRejected: boolean;
  validationIssues: AgentUiStatusSurfaceIssue[];
}

const REQUIRED_SURFACES: AgentUiStatusSurface[] = [
  "footer",
  "header",
  "title",
  "rate_limit",
  "model",
  "reasoning",
  "goal",
  "status_preview",
];

function issue(
  code: AgentUiStatusSurfaceIssueCode,
  path: string,
  message: string,
): AgentUiStatusSurfaceIssue {
  return { code, path, message };
}

function normalizeSurface(value: string | undefined): AgentUiStatusSurface {
  switch (value) {
    case "footer":
    case "status_footer":
    case "statusFooter":
      return "footer";
    case "header":
    case "status_header":
    case "statusHeader":
      return "header";
    case "title":
    case "thread_title":
    case "threadTitle":
      return "title";
    case "rate_limit":
    case "rateLimit":
    case "rate-limit":
      return "rate_limit";
    case "model":
    case "model_picker":
    case "modelPicker":
      return "model";
    case "reasoning":
    case "reasoning_effort":
    case "reasoningEffort":
      return "reasoning";
    case "goal":
    case "plan_goal":
    case "planGoal":
      return "goal";
    case "status_preview":
    case "statusPreview":
    case "runtime_status":
    case "runtimeStatus":
      return "status_preview";
    default:
      return "unknown";
  }
}

function parseSurface(
  value: unknown,
): AgentUiStatusSurfaceRowSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const facts =
    readRecord(record.facts) ??
    readRecord(record.metadata) ??
    readRecord(record.statusFacts) ??
    record;
  const rateLimit =
    readRecord(facts.rateLimit) ??
    readRecord(facts.rate_limit) ??
    readRecord(record.rateLimit) ??
    readRecord(record.rate_limit);
  return compactProjectionFields({
    surface: normalizeSurface(
      readStringField(record, ["surface", "kind", "target"]),
    ),
    presentationOwner: readStringField(record, [
      "presentationOwner",
      "presentation_owner",
      "owner",
      "copyOwner",
      "copy_owner",
    ]),
    threadId: readStringField(record, ["threadId", "thread_id"]),
    sessionId: readStringField(record, ["sessionId", "session_id"]),
    previewText: truncateText(
      readStringField(record, ["previewText", "preview_text", "label", "text"]),
      120,
    ),
    title: readStringField(facts, ["title", "threadTitle", "thread_title"]),
    model: readStringField(facts, ["model", "modelId", "model_id"]),
    reasoningEffort: readStringField(facts, [
      "reasoningEffort",
      "reasoning_effort",
      "effort",
    ]),
    goalId: readStringField(facts, ["goalId", "goal_id", "activeGoalId"]),
    runtimeStatus: readStringField(facts, [
      "runtimeStatus",
      "runtime_status",
      "status",
    ]),
    rateLimitRemaining: readNumberField(rateLimit, [
      "remaining",
      "remainingRequests",
      "remaining_requests",
    ]),
    rateLimitResetAt: readStringField(rateLimit, [
      "resetAt",
      "reset_at",
      "resetsAt",
      "resets_at",
    ]),
    naturalLanguageInferred:
      readBooleanField(record, [
        "naturalLanguageInferred",
        "natural_language_inferred",
        "textInferred",
        "text_inferred",
      ]) === true,
    duplicateComponentNaming:
      readBooleanField(record, [
        "duplicateComponentNaming",
        "duplicate_component_naming",
        "localNaming",
        "local_naming",
      ]) === true,
  } satisfies AgentUiStatusSurfaceRowSnapshot);
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function sameExpected(
  expected: string | undefined,
  values: Array<string | undefined>,
): boolean {
  if (!expected) return true;
  return values.every((value) => value === expected);
}

function hasSurface(
  rows: readonly AgentUiStatusSurfaceRowSnapshot[],
  surface: AgentUiStatusSurface,
): boolean {
  return rows.some((row) => row.surface === surface);
}

function rowFor(
  rows: readonly AgentUiStatusSurfaceRowSnapshot[],
  surface: AgentUiStatusSurface,
): AgentUiStatusSurfaceRowSnapshot | undefined {
  return rows.find((row) => row.surface === surface);
}

function validateStatusMatrix(
  snapshot: Omit<
    AgentUiStatusSurfaceMatrixProjectionSnapshot,
    "validationIssues"
  >,
): AgentUiStatusSurfaceIssue[] {
  const issues: AgentUiStatusSurfaceIssue[] = [];
  for (const surface of REQUIRED_SURFACES) {
    if (!snapshot.coveredSurfaces.includes(surface)) {
      issues.push(
        issue(
          "missing_status_surface",
          `$.surfaces.${surface}`,
          "Status matrix must cover footer, header, title, rate limit, model, reasoning, goal and status preview.",
        ),
      );
    }
  }
  if (!snapshot.threadSessionBindingPreserved) {
    issues.push(
      issue(
        "thread_session_binding_lost",
        "$.surfaces[].threadId",
        "Status surfaces must stay bound to the same session/thread metadata.",
      ),
    );
  }
  if (!snapshot.sharedPresentationOwner) {
    issues.push(
      issue(
        "presentation_owner_split",
        "$.surfaces[].presentationOwner",
        "Status surfaces must use one shared presentation owner.",
      ),
    );
  }
  if (!snapshot.metadataFactsPresent) {
    issues.push(
      issue(
        "metadata_fact_missing",
        "$.surfaces",
        "Model, reasoning, goal and title previews must carry structured metadata facts.",
      ),
    );
  }
  if (!snapshot.runtimeStatusPresent) {
    issues.push(
      issue(
        "runtime_status_missing",
        "$.surfaces.status_preview",
        "Status preview must carry structured runtime status.",
      ),
    );
  }
  if (!snapshot.rateLimitFactsPresent) {
    issues.push(
      issue(
        "rate_limit_fact_missing",
        "$.surfaces.rate_limit",
        "Rate limit preview must carry remaining/reset facts.",
      ),
    );
  }
  if (!snapshot.naturalLanguageInferenceRejected) {
    issues.push(
      issue(
        "natural_language_status_inference",
        "$.surfaces[].naturalLanguageInferred",
        "Status surfaces cannot infer lifecycle from display text.",
      ),
    );
  }
  if (!snapshot.duplicateNamingRejected) {
    issues.push(
      issue(
        "duplicate_component_naming",
        "$.surfaces[].duplicateComponentNaming",
        "Header/footer/title/status components must not each define local status names.",
      ),
    );
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiStatusSurfaceIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractStatusSurfaceMatrixProjectionSnapshot(
  input: AgentUiStatusSurfaceMatrixInput,
): AgentUiStatusSurfaceMatrixProjectionSnapshot {
  const surfaces = (input.rows ?? input.surfaces ?? [])
    .map(parseSurface)
    .filter((row): row is AgentUiStatusSurfaceRowSnapshot => Boolean(row));
  const coveredSurfaces = Array.from(
    new Set(
      surfaces
        .map((row) => row.surface)
        .filter(
          (surface): surface is AgentUiStatusSurface => surface !== "unknown",
        ),
    ),
  ).sort();
  const presentationOwners = uniqueDefined(
    surfaces.map((row) => row.presentationOwner),
  );
  const title = rowFor(surfaces, "title");
  const model = rowFor(surfaces, "model");
  const reasoning = rowFor(surfaces, "reasoning");
  const goal = rowFor(surfaces, "goal");
  const status = rowFor(surfaces, "status_preview");
  const rateLimit = rowFor(surfaces, "rate_limit");
  const partialSnapshot = {
    surfaces,
    coveredSurfaces,
    requiredSurfacesCovered: REQUIRED_SURFACES.every((surface) =>
      hasSurface(surfaces, surface),
    ),
    threadSessionBindingPreserved:
      surfaces.length > 0 &&
      sameExpected(
        input.threadId,
        surfaces.map((row) => row.threadId),
      ) &&
      sameExpected(
        input.sessionId,
        surfaces.map((row) => row.sessionId),
      ),
    sharedPresentationOwner:
      surfaces.length > 0 &&
      presentationOwners.length === 1 &&
      Boolean(presentationOwners[0]),
    metadataFactsPresent:
      Boolean(title?.title) &&
      Boolean(model?.model) &&
      Boolean(reasoning?.reasoningEffort) &&
      Boolean(goal?.goalId),
    runtimeStatusPresent: Boolean(status?.runtimeStatus),
    rateLimitFactsPresent:
      rateLimit?.rateLimitRemaining !== undefined &&
      Boolean(rateLimit.rateLimitResetAt),
    naturalLanguageInferenceRejected: !surfaces.some(
      (row) => row.naturalLanguageInferred,
    ),
    duplicateNamingRejected: !surfaces.some(
      (row) => row.duplicateComponentNaming,
    ),
  };
  return {
    ...partialSnapshot,
    validationIssues: validateStatusMatrix(partialSnapshot),
  };
}

export function buildStatusSurfaceMatrixProjectionEvent(
  input: AgentUiStatusSurfaceMatrixInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractStatusSurfaceMatrixProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "status_surface_matrix_projection" },
      context,
    ),
    type: "state.snapshot",
    sequence: context.sequence,
    owner: "ui_projection",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "runtime_status",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      surfaces: snapshot.surfaces,
      coveredSurfaces: snapshot.coveredSurfaces,
      requiredSurfacesCovered: snapshot.requiredSurfacesCovered,
      threadSessionBindingPreserved: snapshot.threadSessionBindingPreserved,
      sharedPresentationOwner: snapshot.sharedPresentationOwner,
      metadataFactsPresent: snapshot.metadataFactsPresent,
      runtimeStatusPresent: snapshot.runtimeStatusPresent,
      rateLimitFactsPresent: snapshot.rateLimitFactsPresent,
      naturalLanguageInferenceRejected:
        snapshot.naturalLanguageInferenceRejected,
      duplicateNamingRejected: snapshot.duplicateNamingRejected,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : undefined,
  };
}
