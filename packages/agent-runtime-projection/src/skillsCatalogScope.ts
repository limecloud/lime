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

export type AgentUiSkillsCatalogScopeIssueCode =
  | "missing_requested_cwd"
  | "requested_cwd_order_changed"
  | "environment_disabled_cwd_root_loaded"
  | "environment_disabled_cwd_skill_loaded"
  | "runtime_roots_mismatch"
  | "extra_root_missing_from_catalog"
  | "missing_cache_generation"
  | "skill_missing_provenance"
  | "workspace_skill_uses_global_cache"
  | "workspace_skill_from_other_cwd";

export interface AgentUiSkillsCatalogScopeIssue {
  code: AgentUiSkillsCatalogScopeIssueCode;
  path: string;
  message: string;
}

export interface AgentUiSkillsCatalogScopeProjectionInput {
  workspaceId?: string | null;
  cwd?: string | null;
  params?: unknown;
  response?: unknown;
  catalogEntries?: unknown;
  requestedCwdRoots?: unknown;
  effectiveCwdRoots?: unknown;
  extraRoots?: unknown;
  runtimeRequestRoots?: unknown;
  runtimeRequest?: unknown;
  environment?: unknown;
  environmentEnabled?: boolean | null;
  forceReload?: boolean | null;
  cacheGeneration?: string | number | null;
  skills?: unknown;
  timestamp?: string | null;
}

export interface AgentUiSkillsCatalogEntrySnapshot {
  cwd: string;
  skillNames: string[];
  errorCount: number;
}

export interface AgentUiSkillsCatalogSkillSnapshot {
  name: string;
  path?: string;
  scope?: string;
  source?: string;
  root?: string;
  cwd?: string;
  enabled: boolean;
  cacheScope?: string;
  cacheGeneration?: string;
}

export interface AgentUiSkillsCatalogScopeSnapshot {
  workspaceId?: string;
  cwd?: string;
  requestedCwdRoots: string[];
  catalogCwdRoots: string[];
  effectiveCwdRoots: string[];
  extraRoots: string[];
  runtimeRequestRoots: string[];
  environmentEnabled: boolean;
  forceReload: boolean;
  cacheGeneration?: string;
  cacheScoped: boolean;
  skillCount: number;
  catalogEntries: AgentUiSkillsCatalogEntrySnapshot[];
  skills: AgentUiSkillsCatalogSkillSnapshot[];
  validationIssues: AgentUiSkillsCatalogScopeIssue[];
}

function issue(
  code: AgentUiSkillsCatalogScopeIssueCode,
  path: string,
  message: string,
): AgentUiSkillsCatalogScopeIssue {
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
  return trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function readPathList(value: unknown): string[] {
  if (typeof value === "string") {
    return normalizePath(value) ? [normalizePath(value)!] : [];
  }
  if (!Array.isArray(value)) return [];
  return normalizeProjectionIdList(
    value
      .map((item) => {
        if (typeof item === "string") return normalizePath(item);
        const record = readRecord(item);
        return normalizePath(
          readStringField(record, ["path", "root", "cwd", "uri", "value"]),
        );
      })
      .filter((item): item is string => Boolean(item)),
  );
}

function firstPathList(...values: unknown[]): string[] {
  for (const value of values) {
    const paths = readPathList(value);
    if (paths.length > 0) return paths;
  }
  return [];
}

function readGeneration(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return definedString(value);
  }
  return undefined;
}

function paramsRecord(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): Record<string, unknown> {
  return readRecord(input.params) ?? {};
}

function responseRecord(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): Record<string, unknown> {
  return readRecord(input.response) ?? {};
}

function runtimeRequestRecord(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): Record<string, unknown> {
  return readRecord(input.runtimeRequest) ?? {};
}

function environmentEnabled(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): boolean {
  if (typeof input.environmentEnabled === "boolean")
    return input.environmentEnabled;
  const environment = readRecord(input.environment);
  return (
    readBooleanField(environment, ["enabled", "environmentEnabled"]) ?? true
  );
}

function forceReload(input: AgentUiSkillsCatalogScopeProjectionInput): boolean {
  if (typeof input.forceReload === "boolean") return input.forceReload;
  return (
    readBooleanField(paramsRecord(input), ["forceReload", "force_reload"]) ??
    false
  );
}

function requestedCwdRoots(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): string[] {
  const params = paramsRecord(input);
  return firstPathList(
    input.requestedCwdRoots,
    params.cwds,
    params.cwd,
    input.cwd,
  );
}

function extraRoots(input: AgentUiSkillsCatalogScopeProjectionInput): string[] {
  const params = paramsRecord(input);
  return firstPathList(input.extraRoots, params.extraRoots, params.extra_roots);
}

function runtimeRequestRoots(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): string[] {
  const runtimeRequest = runtimeRequestRecord(input);
  return firstPathList(
    input.runtimeRequestRoots,
    runtimeRequest.skillRoots,
    runtimeRequest.skill_roots,
    runtimeRequest.roots,
    runtimeRequest.cwdRoots,
    runtimeRequest.cwd_roots,
  );
}

function responseData(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): Record<string, unknown>[] {
  const response = responseRecord(input);
  const explicit = recordArray(input.catalogEntries);
  if (explicit.length > 0) return explicit;
  return recordArray(response.data);
}

function skillRecords(
  entry: Record<string, unknown>,
): Record<string, unknown>[] {
  const skills = entry.skills;
  if (Array.isArray(skills)) return recordArray(skills);
  const skillMap = readRecord(skills);
  if (!skillMap) return [];
  return Object.entries(skillMap).map(([name, value]) => ({
    name,
    ...(readRecord(value) ?? {}),
  }));
}

function inferSkillRoot(path: string | undefined): string | undefined {
  const normalized = normalizePath(path);
  if (!normalized) return undefined;
  const marker = "/skills/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  return normalized.slice(0, index + "/skills".length);
}

function buildSkillSnapshot(
  record: Record<string, unknown>,
  cwd: string | undefined,
): AgentUiSkillsCatalogSkillSnapshot | undefined {
  const name = readStringField(record, ["name", "id"]);
  if (!name) return undefined;
  const path = normalizePath(
    readStringField(record, [
      "path",
      "pathToSkillsMd",
      "path_to_skills_md",
      "skillPath",
      "skill_path",
    ]),
  );
  const scope = readStringField(record, ["scope"]);
  const source = readStringField(record, [
    "source",
    "origin",
    "providerSource",
    "provider_source",
    "cacheSource",
    "cache_source",
  ]);
  const root =
    normalizePath(
      readStringField(record, [
        "root",
        "skillRoot",
        "skill_root",
        "sourceRoot",
        "source_root",
      ]),
    ) ?? inferSkillRoot(path);
  return compactProjectionFields({
    name,
    path,
    scope,
    source,
    root,
    cwd,
    enabled: readBooleanField(record, ["enabled"]) ?? true,
    cacheScope: readStringField(record, ["cacheScope", "cache_scope"]),
    cacheGeneration: readGeneration(
      record.cacheGeneration ?? record.cache_generation,
    ),
  } satisfies AgentUiSkillsCatalogSkillSnapshot);
}

function catalogEntriesForInput(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): AgentUiSkillsCatalogEntrySnapshot[] {
  return responseData(input)
    .map((entry) => {
      const cwd = normalizePath(
        readStringField(entry, ["cwd", "root", "path"]),
      );
      if (!cwd) return undefined;
      const skills = skillRecords(entry)
        .map((skill) => readStringField(skill, ["name", "id"]))
        .filter((name): name is string => Boolean(name));
      return {
        cwd,
        skillNames: skills,
        errorCount: recordArray(entry.errors).length,
      } satisfies AgentUiSkillsCatalogEntrySnapshot;
    })
    .filter((entry): entry is AgentUiSkillsCatalogEntrySnapshot =>
      Boolean(entry),
    );
}

function skillsForInput(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): AgentUiSkillsCatalogSkillSnapshot[] {
  const skills: AgentUiSkillsCatalogSkillSnapshot[] = [];
  for (const entry of responseData(input)) {
    const cwd = normalizePath(readStringField(entry, ["cwd", "root", "path"]));
    for (const record of skillRecords(entry)) {
      const skill = buildSkillSnapshot(record, cwd);
      if (skill) skills.push(skill);
    }
  }
  for (const record of recordArray(input.skills)) {
    const skill = buildSkillSnapshot(record, undefined);
    if (skill) skills.push(skill);
  }
  return skills;
}

function effectiveCwdRoots(
  input: AgentUiSkillsCatalogScopeProjectionInput,
  skills: readonly AgentUiSkillsCatalogSkillSnapshot[],
): string[] {
  const explicit = readPathList(input.effectiveCwdRoots);
  if (explicit.length > 0) return explicit;
  return normalizeProjectionIdList(
    skills
      .map((skill) => skill.root)
      .filter((root): root is string => Boolean(root)),
  );
}

function pathWithin(
  path: string | undefined,
  root: string | undefined,
): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (!normalizedPath || !normalizedRoot) return false;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function pathsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) => normalizePath(value) === normalizePath(right[index]),
    )
  );
}

function isRepoScopedSkill(skill: AgentUiSkillsCatalogSkillSnapshot): boolean {
  const scope = skill.scope?.toLowerCase();
  const source = skill.source?.toLowerCase();
  return (
    scope === "repo" ||
    scope === "project" ||
    scope === "workspace" ||
    source === "repo" ||
    source === "project" ||
    source === "workspace" ||
    source === "cwd"
  );
}

function isGlobalCacheSkill(skill: AgentUiSkillsCatalogSkillSnapshot): boolean {
  const source = skill.source?.toLowerCase();
  const cacheScope = skill.cacheScope?.toLowerCase();
  return (
    source === "global_cache" ||
    source === "legacy_global_cache" ||
    cacheScope === "global"
  );
}

function hasSkillProvenance(skill: AgentUiSkillsCatalogSkillSnapshot): boolean {
  return Boolean(skill.path && (skill.source || skill.scope || skill.root));
}

function underAnyRoot(
  path: string | undefined,
  roots: readonly string[],
): boolean {
  return roots.some((root) => pathWithin(path, root));
}

function validateSnapshot(
  snapshot: Omit<AgentUiSkillsCatalogScopeSnapshot, "validationIssues">,
): AgentUiSkillsCatalogScopeIssue[] {
  const issues: AgentUiSkillsCatalogScopeIssue[] = [];
  const requestedRoots = snapshot.requestedCwdRoots;
  const workspaceRoots = [
    ...snapshot.requestedCwdRoots,
    ...snapshot.extraRoots,
  ];

  if (!snapshot.cwd && requestedRoots.length === 0) {
    issues.push(
      issue(
        "missing_requested_cwd",
        "$.params.cwds",
        "Skills catalog scope requires the requested cwd roots or current cwd.",
      ),
    );
  }

  if (
    requestedRoots.length > 0 &&
    snapshot.catalogCwdRoots.length >= requestedRoots.length &&
    !pathsEqual(
      snapshot.catalogCwdRoots.slice(0, requestedRoots.length),
      requestedRoots,
    )
  ) {
    issues.push(
      issue(
        "requested_cwd_order_changed",
        "$.response.data[].cwd",
        "Skills list response must preserve the requested cwd order.",
      ),
    );
  }

  if (!snapshot.environmentEnabled) {
    const leakedRoot = snapshot.effectiveCwdRoots.find((root) =>
      requestedRoots.some((cwd) => pathWithin(root, cwd)),
    );
    if (leakedRoot) {
      issues.push(
        issue(
          "environment_disabled_cwd_root_loaded",
          "$.effectiveCwdRoots",
          "Cwd-local skill roots must be skipped when the environment is disabled.",
        ),
      );
    }
  }

  if (
    (snapshot.effectiveCwdRoots.length > 0 ||
      snapshot.runtimeRequestRoots.length > 0) &&
    !pathsEqual(snapshot.runtimeRequestRoots, snapshot.effectiveCwdRoots)
  ) {
    issues.push(
      issue(
        "runtime_roots_mismatch",
        "$.runtimeRequestRoots",
        "Runtime skill request roots must match the catalog effective roots.",
      ),
    );
  }

  snapshot.extraRoots.forEach((root, rootIndex) => {
    if (
      !snapshot.effectiveCwdRoots.some((effectiveRoot) =>
        pathWithin(effectiveRoot, root),
      )
    ) {
      issues.push(
        issue(
          "extra_root_missing_from_catalog",
          `$.extraRoots[${rootIndex}]`,
          "Runtime extra skill roots must be reflected in the catalog effective roots.",
        ),
      );
    }
  });

  if (!snapshot.cacheGeneration) {
    issues.push(
      issue(
        "missing_cache_generation",
        "$.cacheGeneration",
        "Skills catalog scope requires a cache generation keyed by roots.",
      ),
    );
  }

  snapshot.skills.forEach((skill, skillIndex) => {
    if (!hasSkillProvenance(skill)) {
      issues.push(
        issue(
          "skill_missing_provenance",
          `$.skills[${skillIndex}]`,
          "Skill catalog entries must preserve path plus scope/source/root provenance.",
        ),
      );
    }
    if (!snapshot.environmentEnabled && isRepoScopedSkill(skill)) {
      issues.push(
        issue(
          "environment_disabled_cwd_skill_loaded",
          `$.skills[${skillIndex}]`,
          "Repo/cwd skill entries must not load when the environment is disabled.",
        ),
      );
    }
    if (snapshot.workspaceId && isGlobalCacheSkill(skill)) {
      issues.push(
        issue(
          "workspace_skill_uses_global_cache",
          `$.skills[${skillIndex}]`,
          "Workspace skills must not be served from a legacy global-only cache.",
        ),
      );
    }
    if (
      isRepoScopedSkill(skill) &&
      workspaceRoots.length > 0 &&
      !underAnyRoot(skill.root, workspaceRoots) &&
      !underAnyRoot(skill.path, workspaceRoots)
    ) {
      issues.push(
        issue(
          "workspace_skill_from_other_cwd",
          `$.skills[${skillIndex}]`,
          "Repo/cwd skill entries must come from the requested workspace cwd or extra roots.",
        ),
      );
    }
  });

  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiSkillsCatalogScopeIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractSkillsCatalogScopeSnapshot(
  input: AgentUiSkillsCatalogScopeProjectionInput,
): AgentUiSkillsCatalogScopeSnapshot {
  const params = paramsRecord(input);
  const response = responseRecord(input);
  const workspaceId = definedString(input.workspaceId ?? undefined);
  const cwd = normalizePath(input.cwd ?? readStringField(params, ["cwd"]));
  const requestedRoots = requestedCwdRoots(input);
  const skills = skillsForInput(input);
  const effectiveRoots = effectiveCwdRoots(input, skills);
  const catalogEntries = catalogEntriesForInput(input);
  const catalogCwdRoots = catalogEntries.map((entry) => entry.cwd);
  const cacheGeneration = readGeneration(
    input.cacheGeneration ??
      response.cacheGeneration ??
      response.cache_generation,
  );
  const base = {
    workspaceId,
    cwd,
    requestedCwdRoots: requestedRoots,
    catalogCwdRoots,
    effectiveCwdRoots: effectiveRoots,
    extraRoots: extraRoots(input),
    runtimeRequestRoots: runtimeRequestRoots(input),
    environmentEnabled: environmentEnabled(input),
    forceReload: forceReload(input),
    cacheGeneration,
    cacheScoped: Boolean(cacheGeneration),
    skillCount: skills.length,
    catalogEntries,
    skills,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(base),
  };
}

export function buildSkillsCatalogScopeProjectionEvent(
  input: AgentUiSkillsCatalogScopeProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractSkillsCatalogScopeSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "skills_catalog_scope_projection",
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
      skillsCatalogEvent: "catalog_scope",
      workspaceId: snapshot.workspaceId,
      cwd: snapshot.cwd,
      requestedCwdRoots: snapshot.requestedCwdRoots,
      catalogCwdRoots: snapshot.catalogCwdRoots,
      effectiveCwdRoots: snapshot.effectiveCwdRoots,
      extraRoots: snapshot.extraRoots,
      runtimeRequestRoots: snapshot.runtimeRequestRoots,
      environmentEnabled: snapshot.environmentEnabled,
      forceReload: snapshot.forceReload,
      cacheGeneration: snapshot.cacheGeneration,
      cacheScoped: snapshot.cacheScoped,
      skillCount: snapshot.skillCount,
      skillNames: snapshot.skills.map((skill) => skill.name),
      skillsCatalogScope: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
