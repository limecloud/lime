import { describe, expect, it } from "vitest";
import {
  buildEffectiveSiteProfileKey,
  pickPreferredAttachedSiteAdapterProfile,
  pickPreferredSiteAdapterProfile,
} from "./siteProfileSelection";

const MANAGED_PROFILE = {
  id: "profile-managed",
  profile_key: "general_browser_assist",
  name: "通用资料",
  description: null,
  site_scope: "github.com",
  launch_url: "https://github.com",
  transport_kind: "managed_cdp" as const,
  profile_dir: "/tmp/profile-managed",
  managed_profile_dir: "/tmp/profile-managed",
  created_at: "2026-03-26T00:00:00Z",
  updated_at: "2026-03-26T00:00:00Z",
  last_used_at: null,
  archived_at: null,
};

const ATTACHED_PROFILE = {
  id: "profile-existing",
  profile_key: "research_attach",
  name: "研究附着",
  description: null,
  site_scope: null,
  launch_url: "https://github.com",
  transport_kind: "existing_session" as const,
  profile_dir: "",
  managed_profile_dir: null,
  created_at: "2026-03-26T00:00:00Z",
  updated_at: "2026-03-26T00:00:00Z",
  last_used_at: null,
  archived_at: null,
};

describe("siteProfileSelection", () => {
  it("应优先选择已连接的 existing_session 资料", () => {
    expect(
      pickPreferredSiteAdapterProfile({
        profiles: [MANAGED_PROFILE, ATTACHED_PROFILE],
        adapterDomain: "github.com",
        bridgeStatus: {
          observer_count: 1,
          control_count: 0,
          pending_command_count: 0,
          observers: [
            {
              client_id: "observer-1",
              profile_key: "research_attach",
              connected_at: "2026-03-26T00:00:00Z",
              user_agent: "Chrome",
              last_heartbeat_at: "2026-03-26T00:00:01Z",
              last_page_info: {
                title: "GitHub",
                url: "https://github.com/trending",
                markdown: "GitHub",
                updated_at: "2026-03-26T00:00:01Z",
              },
            },
          ],
          controls: [],
          pending_commands: [],
        },
      })?.profile_key,
    ).toBe("research_attach");
  });

  it("没有已连接 existing_session 时应回退到匹配站点的 managed 资料", () => {
    expect(
      pickPreferredSiteAdapterProfile({
        profiles: [ATTACHED_PROFILE, MANAGED_PROFILE],
        adapterDomain: "github.com",
        bridgeStatus: {
          observer_count: 0,
          control_count: 0,
          pending_command_count: 0,
          observers: [],
          controls: [],
          pending_commands: [],
        },
      })?.profile_key,
    ).toBe("general_browser_assist");
  });

  it("附着会话专用选择器应只返回已连接的 existing_session 资料", () => {
    expect(
      pickPreferredAttachedSiteAdapterProfile({
        profiles: [MANAGED_PROFILE, ATTACHED_PROFILE],
        adapterDomain: "github.com",
        bridgeStatus: {
          observer_count: 1,
          control_count: 0,
          pending_command_count: 0,
          observers: [
            {
              client_id: "observer-1",
              profile_key: "research_attach",
              connected_at: "2026-03-26T00:00:00Z",
              user_agent: "Chrome",
              last_heartbeat_at: "2026-03-26T00:00:01Z",
              last_page_info: {
                title: "GitHub",
                url: "https://github.com/trending",
                markdown: "GitHub",
                updated_at: "2026-03-26T00:00:01Z",
              },
            },
          ],
          controls: [],
          pending_commands: [],
        },
      })?.profile_key,
    ).toBe("research_attach");

    expect(
      pickPreferredAttachedSiteAdapterProfile({
        profiles: [MANAGED_PROFILE],
        adapterDomain: "github.com",
        bridgeStatus: {
          observer_count: 0,
          control_count: 0,
          pending_command_count: 0,
          observers: [],
          controls: [],
          pending_commands: [],
        },
      }),
    ).toBeNull();
  });

  it("应按手动值、显式值、推荐值顺序生成有效 profile_key", () => {
    expect(
      buildEffectiveSiteProfileKey({
        manualProfileKey: " manual_profile ",
        selectedProfileKey: "selected_profile",
        recommendedProfile: ATTACHED_PROFILE,
      }),
    ).toBe("manual_profile");
    expect(
      buildEffectiveSiteProfileKey({
        manualProfileKey: " ",
        selectedProfileKey: " selected_profile ",
        recommendedProfile: ATTACHED_PROFILE,
      }),
    ).toBe("selected_profile");
    expect(
      buildEffectiveSiteProfileKey({
        manualProfileKey: null,
        selectedProfileKey: null,
        recommendedProfile: ATTACHED_PROFILE,
      }),
    ).toBe("research_attach");
  });
});
