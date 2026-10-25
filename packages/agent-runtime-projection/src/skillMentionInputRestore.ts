import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  normalizeProjectionIdList,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiSkillMentionInputRestoreStage =
  | "submit"
  | "blocked_image_restore"
  | "queued_restore"
  | "cancel_restore";

export type AgentUiSkillMentionInputRestoreIssueCode =
  | "missing_mention_binding"
  | "binding_missing_path"
  | "binding_token_missing_from_text"
  | "restored_binding_lost"
  | "restored_binding_path_changed"
  | "restored_text_element_missing_binding"
  | "restored_local_image_lost"
  | "duplicate_skill_path_not_preserved"
  | "skill_binding_submitted_as_text_only"
  | "plugin_binding_not_structured"
  | "mention_binding_degraded_to_plain_text";

export interface AgentUiSkillMentionInputRestoreIssue {
  code: AgentUiSkillMentionInputRestoreIssueCode;
  path: string;
  message: string;
}

export interface AgentUiSkillMentionInputRestoreProjectionInput {
  stage?: AgentUiSkillMentionInputRestoreStage | string | null;
  draft?: unknown;
  originalDraft?: unknown;
  restoredDraft?: unknown;
  submittedItems?: unknown;
  availableSkills?: unknown;
  pluginMentions?: unknown;
  timestamp?: string | null;
}

export interface AgentUiSkillMentionBindingSnapshot {
  sigil: string;
  mention: string;
  path: string;
  kind: "skill" | "plugin" | "app" | "unknown";
  token: string;
  normalizedPath: string;
}

export interface AgentUiSkillMentionDraftSnapshot {
  text: string;
  textElementTokens: string[];
  localImagePaths: string[];
  remoteImageUrls: string[];
  mentionBindings: AgentUiSkillMentionBindingSnapshot[];
}

export interface AgentUiSkillMentionSubmittedItemSnapshot {
  type: string;
  name?: string;
  path?: string;
  text?: string;
  normalizedPath?: string;
}

export interface AgentUiSkillMentionAvailableSkillSnapshot {
  name: string;
  path: string;
  normalizedPath: string;
}

export interface AgentUiSkillMentionInputRestoreSnapshot {
  stage: AgentUiSkillMentionInputRestoreStage;
  draft: AgentUiSkillMentionDraftSnapshot;
  restoredDraft?: AgentUiSkillMentionDraftSnapshot;
  submittedItems: AgentUiSkillMentionSubmittedItemSnapshot[];
  availableSkills: AgentUiSkillMentionAvailableSkillSnapshot[];
  duplicateSkillNames: string[];
  bindingCount: number;
  structuredMentionCount: number;
  bindingsStable: boolean;
  structuredMentionsStable: boolean;
  validationIssues: AgentUiSkillMentionInputRestoreIssue[];
}

function issue(
  code: AgentUiSkillMentionInputRestoreIssueCode,
  path: string,
  message: string,
): AgentUiSkillMentionInputRestoreIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizePath(value: string | undefined): string | undefined {
  const trimmed = definedString(value);
  if (!trimmed) return undefined;
  return trimmed
    .replace(/^skill:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
}

function normalizeStage(
  value: string | null | undefined,
): AgentUiSkillMentionInputRestoreStage {
  switch (value) {
    case "blocked_image_restore":
    case "blockedImageRestore":
      return "blocked_image_restore";
    case "queued_restore":
    case "queuedRestore":
      return "queued_restore";
    case "cancel_restore":
    case "cancelRestore":
      return "cancel_restore";
    default:
      return "submit";
  }
}

function bindingKind(path: string): AgentUiSkillMentionBindingSnapshot["kind"] {
  if (path.startsWith("plugin://")) return "plugin";
  if (path.startsWith("app://")) return "app";
  if (path.startsWith("skill://") || path.endsWith("/SKILL.md")) return "skill";
  return "unknown";
}

function buildBinding(
  record: Record<string, unknown>,
): AgentUiSkillMentionBindingSnapshot | undefined {
  const mention = readStringField(record, ["mention", "name", "label"]);
  const path = readStringField(record, ["path", "uri"]);
  if (!mention && !path) return undefined;
  const sigil = readStringField(record, ["sigil"]) ?? "$";
  const normalizedPath = normalizePath(path);
  return compactProjectionFields({
    sigil,
    mention: mention ?? "",
    path: path ?? "",
    kind: path ? bindingKind(path) : "unknown",
    token: `${sigil}${mention ?? ""}`,
    normalizedPath: normalizedPath ?? "",
  } satisfies AgentUiSkillMentionBindingSnapshot);
}

function textElementToken(record: Record<string, unknown>): string | undefined {
  return readStringField(record, [
    "placeholder",
    "token",
    "text",
    "label",
    "displayText",
    "display_text",
  ]);
}

function readImagePaths(value: unknown): string[] {
  if (typeof value === "string") return normalizeProjectionIdList([value]);
  if (!Array.isArray(value)) return [];
  return normalizeProjectionIdList(
    value
      .map((item) => {
        if (typeof item === "string") return item;
        const record = readRecord(item);
        return readStringField(record, ["path", "url", "uri"]);
      })
      .filter((item): item is string => Boolean(item)),
  );
}

function readDraft(value: unknown): AgentUiSkillMentionDraftSnapshot {
  const record = readRecord(value) ?? {};
  return {
    text: readStringField(record, ["text", "message", "content"]) ?? "",
    textElementTokens: normalizeProjectionIdList(
      recordArray(record.textElements ?? record.text_elements)
        .map(textElementToken)
        .filter((token): token is string => Boolean(token)),
    ),
    localImagePaths: readImagePaths(record.localImages ?? record.local_images),
    remoteImageUrls: readImagePaths(
      record.remoteImageUrls ?? record.remote_image_urls,
    ),
    mentionBindings: recordArray(
      record.mentionBindings ?? record.mention_bindings,
    )
      .map(buildBinding)
      .filter((binding): binding is AgentUiSkillMentionBindingSnapshot =>
        Boolean(binding),
      ),
  };
}

function itemType(record: Record<string, unknown>): string {
  const raw =
    readStringField(record, ["type", "kind", "itemType", "item_type"]) ?? "";
  return raw.replace(/^UserInput::/, "").toLowerCase();
}

function readSubmittedItems(
  value: unknown,
): AgentUiSkillMentionSubmittedItemSnapshot[] {
  const items: AgentUiSkillMentionSubmittedItemSnapshot[] = [];
  for (const record of recordArray(value)) {
    const type = itemType(record);
    const path = readStringField(record, ["path", "uri"]);
    const text = readStringField(record, ["text", "content"]);
    const name = readStringField(record, ["name", "mention", "label"]);
    if (!type && !path && !text && !name) continue;
    items.push(
      compactProjectionFields({
        type,
        name,
        path,
        text,
        normalizedPath: normalizePath(path),
      } satisfies AgentUiSkillMentionSubmittedItemSnapshot),
    );
  }
  return items;
}

function readAvailableSkills(
  value: unknown,
): AgentUiSkillMentionAvailableSkillSnapshot[] {
  return recordArray(value)
    .map((record) => {
      const name = readStringField(record, ["name", "id"]);
      const path = readStringField(record, [
        "path",
        "pathToSkillsMd",
        "path_to_skills_md",
      ]);
      const normalizedPath = normalizePath(path);
      if (!name || !path || !normalizedPath) return undefined;
      return { name, path, normalizedPath };
    })
    .filter((item): item is AgentUiSkillMentionAvailableSkillSnapshot =>
      Boolean(item),
    );
}

function duplicateSkillNames(
  skills: readonly AgentUiSkillMentionAvailableSkillSnapshot[],
): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

function submittedSkillPaths(
  items: readonly AgentUiSkillMentionSubmittedItemSnapshot[],
): Set<string> {
  return new Set(
    items
      .filter((item) => item.type === "skill")
      .map((item) => item.normalizedPath)
      .filter((path): path is string => Boolean(path)),
  );
}

function submittedMentionPaths(
  items: readonly AgentUiSkillMentionSubmittedItemSnapshot[],
): Set<string> {
  return new Set(
    items
      .filter((item) => item.type === "mention")
      .map((item) => item.path)
      .filter((path): path is string => Boolean(path)),
  );
}

function matchingRestoredBinding(
  binding: AgentUiSkillMentionBindingSnapshot,
  restored: AgentUiSkillMentionDraftSnapshot,
): AgentUiSkillMentionBindingSnapshot | undefined {
  return restored.mentionBindings.find(
    (item) => item.sigil === binding.sigil && item.mention === binding.mention,
  );
}

function validateSnapshot(
  snapshot: Omit<AgentUiSkillMentionInputRestoreSnapshot, "validationIssues">,
): AgentUiSkillMentionInputRestoreIssue[] {
  const issues: AgentUiSkillMentionInputRestoreIssue[] = [];
  const skillPaths = submittedSkillPaths(snapshot.submittedItems);
  const mentionPaths = submittedMentionPaths(snapshot.submittedItems);

  if (snapshot.draft.mentionBindings.length === 0) {
    issues.push(
      issue(
        "missing_mention_binding",
        "$.draft.mentionBindings",
        "Skill/plugin mention restore requires structured mention bindings.",
      ),
    );
  }

  snapshot.draft.mentionBindings.forEach((binding, bindingIndex) => {
    if (!binding.path || !binding.normalizedPath) {
      issues.push(
        issue(
          "binding_missing_path",
          `$.draft.mentionBindings[${bindingIndex}].path`,
          "Mention bindings must preserve the selected skill/plugin path.",
        ),
      );
    }
    if (binding.mention && !snapshot.draft.text.includes(binding.token)) {
      issues.push(
        issue(
          "binding_token_missing_from_text",
          `$.draft.mentionBindings[${bindingIndex}]`,
          "Mention binding token must still exist in draft text.",
        ),
      );
    }
    if (
      binding.kind === "skill" &&
      binding.normalizedPath &&
      snapshot.submittedItems.length > 0 &&
      !skillPaths.has(binding.normalizedPath)
    ) {
      issues.push(
        issue(
          snapshot.duplicateSkillNames.includes(binding.mention.toLowerCase())
            ? "duplicate_skill_path_not_preserved"
            : "skill_binding_submitted_as_text_only",
          "$.submittedItems",
          "Skill mention bindings must submit a structured Skill item using the selected path.",
        ),
      );
    }
    if (
      binding.kind === "plugin" &&
      snapshot.submittedItems.length > 0 &&
      !mentionPaths.has(binding.path)
    ) {
      issues.push(
        issue(
          "plugin_binding_not_structured",
          "$.submittedItems",
          "Plugin mention bindings must submit a structured Mention item.",
        ),
      );
    }
  });

  if (snapshot.restoredDraft) {
    snapshot.draft.mentionBindings.forEach((binding, bindingIndex) => {
      const restored = matchingRestoredBinding(
        binding,
        snapshot.restoredDraft!,
      );
      if (!restored) {
        issues.push(
          issue(
            "restored_binding_lost",
            `$.restoredDraft.mentionBindings[${bindingIndex}]`,
            "Restored composer draft must keep mention bindings.",
          ),
        );
      } else if (restored.normalizedPath !== binding.normalizedPath) {
        issues.push(
          issue(
            "restored_binding_path_changed",
            `$.restoredDraft.mentionBindings[${bindingIndex}].path`,
            "Restored mention binding path must match the original selected path.",
          ),
        );
      }
      if (!snapshot.restoredDraft!.textElementTokens.includes(binding.token)) {
        issues.push(
          issue(
            "restored_text_element_missing_binding",
            "$.restoredDraft.textElements",
            "Restored composer text elements must include the structured mention token.",
          ),
        );
      }
    });
    if (
      snapshot.stage === "blocked_image_restore" &&
      snapshot.draft.localImagePaths.some(
        (path) => !snapshot.restoredDraft!.localImagePaths.includes(path),
      )
    ) {
      issues.push(
        issue(
          "restored_local_image_lost",
          "$.restoredDraft.localImages",
          "Blocked image restore must keep local image attachments for retry.",
        ),
      );
    }
  }

  if (
    snapshot.draft.mentionBindings.length > 0 &&
    snapshot.submittedItems.length > 0 &&
    !snapshot.submittedItems.some(
      (item) => item.type === "skill" || item.type === "mention",
    )
  ) {
    issues.push(
      issue(
        "mention_binding_degraded_to_plain_text",
        "$.submittedItems",
        "Mention bindings must not degrade to plain text-only submissions.",
      ),
    );
  }

  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiSkillMentionInputRestoreIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractSkillMentionInputRestoreSnapshot(
  input: AgentUiSkillMentionInputRestoreProjectionInput,
): AgentUiSkillMentionInputRestoreSnapshot {
  const draft = readDraft(input.draft ?? input.originalDraft);
  const restored = input.restoredDraft
    ? readDraft(input.restoredDraft)
    : undefined;
  const submittedItems = readSubmittedItems(input.submittedItems);
  const availableSkills = readAvailableSkills(input.availableSkills);
  const duplicates = duplicateSkillNames(availableSkills);
  const base = compactProjectionFields({
    stage: normalizeStage(input.stage ?? undefined),
    draft,
    restoredDraft: restored,
    submittedItems,
    availableSkills,
    duplicateSkillNames: duplicates,
    bindingCount: draft.mentionBindings.length,
    structuredMentionCount: submittedItems.filter(
      (item) => item.type === "skill" || item.type === "mention",
    ).length,
    bindingsStable: true,
    structuredMentionsStable: true,
  } satisfies Omit<
    AgentUiSkillMentionInputRestoreSnapshot,
    "validationIssues"
  >);
  const validationIssues = validateSnapshot(base);
  return {
    ...base,
    bindingsStable: !validationIssues.some((item) =>
      item.code.startsWith("restored_"),
    ),
    structuredMentionsStable: validationIssues.length === 0,
    validationIssues,
  };
}

export function buildSkillMentionInputRestoreProjectionEvent(
  input: AgentUiSkillMentionInputRestoreProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractSkillMentionInputRestoreSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "skill_mention_input_restore_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
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
      skillMentionInputRestoreEvent: snapshot.stage,
      bindingCount: snapshot.bindingCount,
      structuredMentionCount: snapshot.structuredMentionCount,
      duplicateSkillNames: snapshot.duplicateSkillNames,
      bindingsStable: snapshot.bindingsStable,
      structuredMentionsStable: snapshot.structuredMentionsStable,
      skillMentionInputRestore: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
