import type { TeamDefinition } from "./teamDefinitions";
import { extractExistingHarnessMetadata } from "./harnessRequestMetadata";

export interface AttachSelectedTeamToRequestMetadataOptions {
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
}

export function attachSelectedTeamToRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  options: AttachSelectedTeamToRequestMetadataOptions,
): Record<string, unknown> | undefined {
  const {
    preferredTeamPresetId,
    selectedTeam,
    selectedTeamLabel,
    selectedTeamSummary,
  } = options;

  if (!selectedTeam) {
    return requestMetadata;
  }

  const existingHarness = extractExistingHarnessMetadata(requestMetadata) || {};
  return {
    ...(requestMetadata || {}),
    harness: {
      ...existingHarness,
      preferred_team_preset_id: preferredTeamPresetId || undefined,
      selected_team_id: selectedTeam.id,
      selected_team_source: selectedTeam.source,
      selected_team_label: selectedTeamLabel || selectedTeam.label,
      selected_team_description: selectedTeam.description || undefined,
      selected_team_summary: selectedTeamSummary || undefined,
      selected_team_roles:
        selectedTeam.roles.length > 0
          ? selectedTeam.roles.map((role) => ({
              id: role.id,
              label: role.label,
              summary: role.summary,
              profile_id: role.profileId || undefined,
              role_key: role.roleKey || undefined,
              skill_ids:
                role.skillIds && role.skillIds.length > 0
                  ? [...role.skillIds]
                  : undefined,
            }))
          : undefined,
    },
  };
}
