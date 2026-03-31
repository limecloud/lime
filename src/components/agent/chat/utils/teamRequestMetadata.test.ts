import { describe, expect, it } from "vitest";
import { attachSelectedTeamToRequestMetadata } from "./teamRequestMetadata";

describe("attachSelectedTeamToRequestMetadata", () => {
  it("应在保留原有 harness 字段的同时追加当前 Team", () => {
    expect(
      attachSelectedTeamToRequestMetadata(
        {
          artifact: {
            artifact_kind: "analysis",
          },
          harness: {
            service_skill_launch: {
              adapter_name: "github/search",
            },
          },
        },
        {
          preferredTeamPresetId: "research-duo",
          selectedTeam: {
            id: "team-research-duo",
            source: "builtin",
            label: "研究双人组",
            description: "负责检索与整理。",
            roles: [
              {
                id: "researcher",
                label: "研究员",
                summary: "负责检索线索。",
                skillIds: ["web-search"],
              },
            ],
          },
          selectedTeamLabel: "研究双人组",
          selectedTeamSummary: "研究员负责检索线索。",
        },
      ),
    ).toEqual({
      artifact: {
        artifact_kind: "analysis",
      },
      harness: {
        service_skill_launch: {
          adapter_name: "github/search",
        },
        preferred_team_preset_id: "research-duo",
        selected_team_id: "team-research-duo",
        selected_team_source: "builtin",
        selected_team_label: "研究双人组",
        selected_team_description: "负责检索与整理。",
        selected_team_summary: "研究员负责检索线索。",
        selected_team_roles: [
          {
            id: "researcher",
            label: "研究员",
            summary: "负责检索线索。",
            profile_id: undefined,
            role_key: undefined,
            skill_ids: ["web-search"],
          },
        ],
      },
    });
  });

  it("缺少当前 Team 时应保持原 metadata 不变", () => {
    const requestMetadata = {
      harness: {
        service_skill_launch: {
          adapter_name: "github/search",
        },
      },
    };

    expect(
      attachSelectedTeamToRequestMetadata(requestMetadata, {}),
    ).toBe(requestMetadata);
  });
});
