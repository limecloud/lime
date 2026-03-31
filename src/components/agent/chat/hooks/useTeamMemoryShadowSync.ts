import { useEffect, useMemo, useState } from "react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  readTeamMemorySnapshot,
  writeTeamMemorySnapshot,
  type TeamMemoryEntry,
  type TeamMemorySnapshot,
  type TeamMemoryStorageLike,
} from "@/lib/teamMemorySync";
import {
  createTeamDefinitionFromPreset,
  normalizeTeamDefinition,
  type TeamDefinition,
} from "../utils/teamDefinitions";

const TEAM_SELECTION_MEMORY_KEY = "team.selection";
const TEAM_SUBAGENT_MEMORY_KEY = "team.subagents";
const TEAM_PARENT_CONTEXT_MEMORY_KEY = "team.parent_context";

interface TeamMemoryShadowSyncOptions {
  repoScope?: string | null;
  activeTheme?: string | null;
  sessionId?: string | null;
  selectedTeam?: TeamDefinition | null;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  storage?: TeamMemoryStorageLike | null;
}

function normalizeLine(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function buildTeamSelectionMemoryContent(params: {
  activeTheme?: string | null;
  sessionId?: string | null;
  selectedTeam?: TeamDefinition | null;
}): string | null {
  const team = params.selectedTeam;
  if (!team) {
    return null;
  }

  const lines = [
    params.activeTheme ? `主题：${params.activeTheme}` : null,
    params.sessionId ? `会话：${params.sessionId}` : null,
    `Team：${team.label}`,
    `来源：${team.source}`,
    team.presetId ? `预设：${team.presetId}` : null,
    normalizeLine(team.description) ? `说明：${normalizeLine(team.description)}` : null,
    team.roles.length > 0 ? "角色：" : null,
    ...team.roles.map((role) =>
      `- ${role.label}：${normalizeLine(role.summary) || "负责当前子任务"}`
    ),
  ].filter((item): item is string => Boolean(item));

  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeSubagentSession(session: AsterSubagentSessionInfo): string {
  const status =
    normalizeLine(session.runtime_status) ||
    normalizeLine(session.latest_turn_status) ||
    "idle";
  const role =
    normalizeLine(session.blueprint_role_label) ||
    normalizeLine(session.role_hint) ||
    normalizeLine(session.role_key);
  const task = normalizeLine(session.task_summary);
  const suffix = [role, task].filter(Boolean).join(" · ");
  return `- ${session.name} [${status}]${suffix ? ` ${suffix}` : ""}`;
}

function buildSubagentMemoryContent(params: {
  sessionId?: string | null;
  childSubagentSessions?: AsterSubagentSessionInfo[];
}): string | null {
  const sessions = (params.childSubagentSessions || []).filter(
    (session) => normalizeLine(session.name),
  );
  if (sessions.length === 0) {
    return null;
  }

  return [
    params.sessionId ? `会话：${params.sessionId}` : null,
    "子代理：",
    ...sessions.map(summarizeSubagentSession),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function buildParentContextMemoryContent(
  context?: AsterSubagentParentContext | null,
): string | null {
  if (!context?.parent_session_id?.trim()) {
    return null;
  }

  const siblingSessions = (context.sibling_subagent_sessions || []).filter(
    (session) => normalizeLine(session.name),
  );

  return [
    `父会话：${context.parent_session_name || context.parent_session_id}`,
    normalizeLine(context.role_hint) ? `当前角色：${normalizeLine(context.role_hint)}` : null,
    normalizeLine(context.task_summary) ? `当前任务：${normalizeLine(context.task_summary)}` : null,
    siblingSessions.length > 0 ? "兄弟会话：" : null,
    ...siblingSessions.map(summarizeSubagentSession),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function upsertMemoryEntry(
  entries: Record<string, TeamMemoryEntry>,
  key: string,
  content: string | null,
  updatedAt: number,
) {
  if (!content) {
    delete entries[key];
    return;
  }

  const existing = entries[key];
  if (existing?.content === content) {
    entries[key] = {
      ...existing,
      key,
    };
    return;
  }

  entries[key] = {
    key,
    content,
    updatedAt,
  };
}

export function syncTeamMemoryShadowSnapshot(
  options: TeamMemoryShadowSyncOptions,
): TeamMemorySnapshot | null {
  const repoScope = options.repoScope?.trim();
  const storage = options.storage ?? null;
  if (!repoScope || !storage) {
    return null;
  }

  const existingSnapshot = readTeamMemorySnapshot(storage, repoScope);
  const snapshot = existingSnapshot ?? {
    repoScope,
    entries: {},
  };
  const nextEntries = { ...snapshot.entries };
  const updatedAt = Date.now();

  upsertMemoryEntry(
    nextEntries,
    TEAM_SELECTION_MEMORY_KEY,
    buildTeamSelectionMemoryContent(options),
    updatedAt,
  );
  upsertMemoryEntry(
    nextEntries,
    TEAM_SUBAGENT_MEMORY_KEY,
    buildSubagentMemoryContent(options),
    updatedAt,
  );
  upsertMemoryEntry(
    nextEntries,
    TEAM_PARENT_CONTEXT_MEMORY_KEY,
    buildParentContextMemoryContent(options.subagentParentContext),
    updatedAt,
  );

  const nextSnapshot: TeamMemorySnapshot = {
    repoScope,
    entries: nextEntries,
  };

  if (Object.keys(nextEntries).length === 0 && !existingSnapshot) {
    return null;
  }

  if (
    snapshot.repoScope === nextSnapshot.repoScope &&
    JSON.stringify(snapshot.entries) === JSON.stringify(nextSnapshot.entries)
  ) {
    return nextSnapshot;
  }

  writeTeamMemorySnapshot(storage, nextSnapshot);
  return nextSnapshot;
}

function readMemoryField(
  lines: string[],
  prefix: string,
): string | null {
  const target = `${prefix}：`;
  const matchedLine = lines.find((line) => line.startsWith(target));
  if (!matchedLine) {
    return null;
  }
  const value = matchedLine.slice(target.length).trim();
  return value || null;
}

function parseRoleLines(lines: string[]) {
  return lines
    .filter((line) => line.startsWith("- "))
    .map((line, index) => {
      const roleText = line.slice(2).trim();
      const separatorIndex = roleText.indexOf("：");
      const label =
        separatorIndex >= 0 ? roleText.slice(0, separatorIndex).trim() : roleText;
      const summary =
        separatorIndex >= 0
          ? roleText.slice(separatorIndex + 1).trim()
          : "负责当前子任务";

      return {
        id: `shadow-role-${index + 1}`,
        label: label || `角色 ${index + 1}`,
        summary: summary || "负责当前子任务",
      };
    });
}

export function resolveSelectedTeamFromShadowSnapshot(
  snapshot?: TeamMemorySnapshot | null,
  activeTheme?: string | null,
): TeamDefinition | null {
  const selectionEntry = snapshot?.entries[TEAM_SELECTION_MEMORY_KEY];
  const content = selectionEntry?.content?.trim();
  if (!content) {
    return null;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entryTheme = readMemoryField(lines, "主题");
  const normalizedActiveTheme = activeTheme?.trim().toLowerCase() || null;
  if (
    entryTheme &&
    normalizedActiveTheme &&
    entryTheme.trim().toLowerCase() !== normalizedActiveTheme
  ) {
    return null;
  }

  const source = readMemoryField(lines, "来源");
  const presetId = readMemoryField(lines, "预设");
  const label = readMemoryField(lines, "Team");
  const description = readMemoryField(lines, "说明");
  const roles = parseRoleLines(lines);

  if ((source === "builtin" || presetId) && presetId) {
    const presetTeam = createTeamDefinitionFromPreset(presetId);
    if (presetTeam) {
      return presetTeam;
    }
  }

  if (!label || roles.length === 0) {
    return null;
  }

  return normalizeTeamDefinition({
    id:
      presetId ||
      `shadow-team-${label.replace(/\s+/g, "-").toLowerCase()}`,
    source: source === "custom" ? "custom" : "custom",
    label,
    description: description || "",
    theme: entryTheme || undefined,
    presetId: presetId || undefined,
    roles,
    updatedAt: selectionEntry?.updatedAt,
  });
}

function serializeTeamDefinition(team?: TeamDefinition | null): string {
  if (!team) {
    return "null";
  }

  return JSON.stringify({
    id: team.id,
    source: team.source,
    label: team.label,
    description: team.description,
    presetId: team.presetId ?? null,
    roles: team.roles.map((role) => ({
      id: role.id,
      label: role.label,
      summary: role.summary,
    })),
  });
}

function serializeSubagentSessions(
  sessions?: AsterSubagentSessionInfo[],
): string {
  return JSON.stringify(
    (sessions || []).map((session) => ({
      id: session.id,
      name: session.name,
      runtime_status: session.runtime_status ?? null,
      latest_turn_status: session.latest_turn_status ?? null,
      task_summary: session.task_summary ?? null,
      role_hint: session.role_hint ?? null,
      role_key: session.role_key ?? null,
      blueprint_role_label: session.blueprint_role_label ?? null,
    })),
  );
}

function serializeParentContext(
  context?: AsterSubagentParentContext | null,
): string {
  if (!context) {
    return "null";
  }

  return JSON.stringify({
    parent_session_id: context.parent_session_id,
    parent_session_name: context.parent_session_name,
    role_hint: context.role_hint ?? null,
    task_summary: context.task_summary ?? null,
    sibling_subagent_sessions: (context.sibling_subagent_sessions || []).map(
      (session) => ({
        id: session.id,
        name: session.name,
        runtime_status: session.runtime_status ?? null,
        latest_turn_status: session.latest_turn_status ?? null,
        task_summary: session.task_summary ?? null,
        role_hint: session.role_hint ?? null,
      }),
    ),
  });
}

function serializeSnapshot(snapshot?: TeamMemorySnapshot | null): string {
  if (!snapshot) {
    return "null";
  }

  return JSON.stringify({
    repoScope: snapshot.repoScope,
    entries: snapshot.entries,
  });
}

export function useTeamMemoryShadowSync(
  options: TeamMemoryShadowSyncOptions,
): TeamMemorySnapshot | null {
  const storage = options.storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  const [snapshot, setSnapshot] = useState<TeamMemorySnapshot | null>(null);
  const teamKey = useMemo(
    () => serializeTeamDefinition(options.selectedTeam),
    [options.selectedTeam],
  );
  const childSessionsKey = useMemo(
    () => serializeSubagentSessions(options.childSubagentSessions),
    [options.childSubagentSessions],
  );
  const parentContextKey = useMemo(
    () => serializeParentContext(options.subagentParentContext),
    [options.subagentParentContext],
  );

  useEffect(() => {
    const nextSnapshot = syncTeamMemoryShadowSnapshot({
      repoScope: options.repoScope,
      activeTheme: options.activeTheme,
      sessionId: options.sessionId,
      selectedTeam: options.selectedTeam,
      childSubagentSessions: options.childSubagentSessions,
      subagentParentContext: options.subagentParentContext,
      storage,
    });
    setSnapshot((current) =>
      serializeSnapshot(current) === serializeSnapshot(nextSnapshot)
        ? current
        : nextSnapshot,
    );
  }, [
    childSessionsKey,
    options.activeTheme,
    options.repoScope,
    options.sessionId,
    options.selectedTeam,
    options.childSubagentSessions,
    options.subagentParentContext,
    parentContextKey,
    storage,
    teamKey,
  ]);

  return snapshot;
}
