import {
  TEAM_PRESET_OPTIONS,
  getTeamPresetOption,
  type TeamPresetOption,
} from "./teamPresets";

export type TeamDefinitionSource = "builtin" | "custom" | "ephemeral";
export type PersistableTeamDefinitionSource = Exclude<
  TeamDefinitionSource,
  "ephemeral"
>;

export interface TeamRoleDefinition {
  id: string;
  label: string;
  summary: string;
  profileId?: string;
  roleKey?: string;
  skillIds?: string[];
}

export interface TeamDefinition {
  id: string;
  source: TeamDefinitionSource;
  label: string;
  description: string;
  theme?: string;
  presetId?: string;
  roles: TeamRoleDefinition[];
  createdAt?: number;
  updatedAt?: number;
}

export interface TeamSelectionReference {
  id: string;
  source: PersistableTeamDefinitionSource;
}

function normalizeText(value?: string | null): string {
  return value?.trim() || "";
}

function normalizeRoleLabel(label?: string | null, fallback = "角色"): string {
  return normalizeText(label) || fallback;
}

function normalizeRoleSummary(
  summary?: string | null,
  label?: string | null,
): string {
  return (
    normalizeText(summary) || `${normalizeRoleLabel(label)}负责当前子任务。`
  );
}

export function createTeamDefinitionId(prefix = "team"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createTeamDefinitionFromPreset(
  presetOrId: TeamPresetOption | string,
): TeamDefinition | null {
  const preset =
    typeof presetOrId === "string"
      ? getTeamPresetOption(presetOrId)
      : presetOrId;
  if (!preset) {
    return null;
  }

  return {
    id: preset.id,
    source: "builtin",
    label: preset.label,
    description: preset.description,
    theme: preset.theme,
    presetId: preset.id,
    roles: preset.roles.map((role) => ({
      id: role.id,
      label: role.label,
      summary: role.summary,
      profileId: role.profileId,
      roleKey: role.roleKey,
      skillIds: role.skillIds ? [...role.skillIds] : [],
    })),
  };
}

export function listBuiltinTeamDefinitions(): TeamDefinition[] {
  return TEAM_PRESET_OPTIONS.map((preset) =>
    createTeamDefinitionFromPreset(preset),
  ).filter((team): team is TeamDefinition => Boolean(team));
}

export function cloneTeamDefinitionAsCustom(
  team: TeamDefinition,
  overrides?: Partial<Pick<TeamDefinition, "label" | "description" | "theme">>,
): TeamDefinition {
  const now = Date.now();
  const label =
    normalizeText(overrides?.label) ||
    (team.source === "builtin" ? `${team.label} · 自定义` : team.label);

  return {
    id: createTeamDefinitionId("custom-team"),
    source: "custom",
    label,
    description:
      normalizeText(overrides?.description) || normalizeText(team.description),
    theme:
      normalizeText(overrides?.theme) || normalizeText(team.theme) || undefined,
    presetId: team.presetId,
    roles: team.roles.map((role, index) => ({
      id: normalizeText(role.id) || `role-${index + 1}`,
      label: normalizeRoleLabel(role.label, `角色 ${index + 1}`),
      summary: normalizeRoleSummary(role.summary, role.label),
      profileId: normalizeText(role.profileId) || undefined,
      roleKey: normalizeText(role.roleKey) || undefined,
      skillIds:
        role.skillIds
          ?.map((skillId) => normalizeText(skillId))
          .filter(Boolean) || [],
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeTeamDefinition(
  value: Partial<TeamDefinition>,
): TeamDefinition | null {
  const label = normalizeText(value.label);
  if (!label) {
    return null;
  }

  const roles = (value.roles || [])
    .map((role, index) => {
      const roleLabel = normalizeRoleLabel(role.label, `角色 ${index + 1}`);
      return {
        id: normalizeText(role.id) || `role-${index + 1}`,
        label: roleLabel,
        summary: normalizeRoleSummary(role.summary, roleLabel),
        profileId: normalizeText(role.profileId) || undefined,
        roleKey: normalizeText(role.roleKey) || undefined,
        skillIds:
          role.skillIds
            ?.map((skillId) => normalizeText(skillId))
            .filter(Boolean) || [],
      };
    })
    .filter((role) => role.label.trim().length > 0);

  if (roles.length === 0) {
    return null;
  }

  return {
    id: normalizeText(value.id) || createTeamDefinitionId("custom-team"),
    source:
      value.source === "builtin"
        ? "builtin"
        : value.source === "ephemeral"
          ? "ephemeral"
          : "custom",
    label,
    description: normalizeText(value.description),
    theme: normalizeText(value.theme) || undefined,
    presetId: normalizeText(value.presetId) || undefined,
    roles,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt ?? Date.now(),
  };
}

export function buildTeamDefinitionSummary(
  team?: TeamDefinition | null,
): string {
  if (!team) {
    return "";
  }

  const roleSummary = team.roles
    .map((role) => `${role.label}：${role.summary}`)
    .join("；");
  const description = normalizeText(team.description);

  if (description && roleSummary) {
    return `${description} 角色分工：${roleSummary}`;
  }
  return description || roleSummary;
}

export function buildTeamDefinitionLabel(team?: TeamDefinition | null): string {
  if (!team) {
    return "";
  }
  return team.label.trim();
}

export function buildTeamSelectionReference(
  team?: TeamDefinition | null,
): TeamSelectionReference | null {
  if (!team || team.source === "ephemeral") {
    return null;
  }

  return {
    id: team.id,
    source: team.source,
  };
}
