import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import {
  buildServiceSceneLaunchRequestMetadata,
  matchesRuntimeSceneEntry,
  parseRuntimeSceneCommand,
  resolveRuntimeSceneLaunchRequest,
} from "./serviceSkillSceneLaunch";

const mockGetSkillCatalog = vi.hoisted(() => vi.fn());
const mockListSkillCatalogSceneEntries = vi.hoisted(() => vi.fn());
const mockResolveOemCloudRuntimeContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/skillCatalog", () => ({
  getSkillCatalog: () => mockGetSkillCatalog(),
  listSkillCatalogSceneEntries: (catalog: unknown) =>
    mockListSkillCatalogSceneEntries(catalog),
}));

vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => mockResolveOemCloudRuntimeContext(),
}));

function createCloudSceneSkill(): ServiceSkillHomeItem {
  return {
    id: "cloud-video-dubbing",
    skillKey: "campaign-launch",
    title: "云端视频配音",
    summary: "把视频文案与素材提交到云端，生成一版可继续加工的配音结果。",
    category: "视频创作",
    outputHint: "配音文案 + 结果摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "cloud_scene",
    executionLocation: "cloud_required",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "云端托管执行",
    runnerTone: "slate",
    runnerDescription: "提交到 OEM 云端执行，结果由服务端异步返回。",
    actionLabel: "提交云端",
    automationStatus: null,
    slotSchema: [],
  };
}

describe("serviceSkillSceneLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSkillCatalog.mockResolvedValue({ entries: [] });
    mockListSkillCatalogSceneEntries.mockReturnValue([]);
    mockResolveOemCloudRuntimeContext.mockReturnValue(null);
  });

  it("应解析 slash scene 命令", () => {
    expect(parseRuntimeSceneCommand("/campaign-launch 帮我做一版新品活动方案"))
      .toEqual({
        sceneKey: "campaign-launch",
        userInput: "帮我做一版新品活动方案",
      });
    expect(parseRuntimeSceneCommand("campaign-launch")).toBeNull();
  });

  it("scene 匹配时应同时支持 sceneKey、commandPrefix 与 alias", () => {
    const entry = {
      sceneKey: "campaign-launch",
      commandPrefix: "/campaign-launch",
      aliases: ["campaign", "launch"],
    };

    expect(matchesRuntimeSceneEntry(entry as never, "campaign-launch")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry as never, "/campaign-launch")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry as never, "campaign")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry as never, "other")).toBe(false);
  });

  it("应构建统一的 service scene launch request metadata", async () => {
    mockGetSkillCatalog.mockResolvedValueOnce({ entries: [] });
    mockListSkillCatalogSceneEntries.mockReturnValueOnce([
      {
        id: "scene:campaign-launch",
        kind: "scene",
        title: "活动启动场景",
        summary: "围绕活动目标生成启动方案。",
        sceneKey: "campaign-launch",
        commandPrefix: "/campaign-launch",
        linkedSkillId: "cloud-video-dubbing",
        executionKind: "cloud_scene",
      },
    ]);
    mockResolveOemCloudRuntimeContext.mockReturnValueOnce({
      baseUrl: "https://user.150404.xyz",
      controlPlaneBaseUrl: "https://user.150404.xyz/api",
      sceneBaseUrl: "https://user.150404.xyz/scene-api",
      gatewayBaseUrl: "https://user.150404.xyz/gateway-api",
      tenantId: "tenant-demo",
      sessionToken: "session-token-demo",
      hubProviderName: null,
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });

    const request = await resolveRuntimeSceneLaunchRequest({
      rawText: "/campaign-launch 帮我做一版新品活动启动方案",
      serviceSkills: [createCloudSceneSkill()],
      projectId: "project-1",
      contentId: "content-1",
    });

    expect(request).not.toBeNull();
    const requestMetadata = buildServiceSceneLaunchRequestMetadata(
      undefined,
      request!.requestContext,
    );

    expect(requestMetadata).toMatchObject({
      harness: {
        service_scene_launch: {
          kind: "cloud_scene",
          service_scene_run: {
            scene_key: "campaign-launch",
            skill_id: "cloud-video-dubbing",
            project_id: "project-1",
            content_id: "content-1",
            user_input: "帮我做一版新品活动启动方案",
            oem_runtime: {
              scene_base_url: "https://user.150404.xyz/scene-api",
              tenant_id: "tenant-demo",
              session_token: "session-token-demo",
            },
          },
        },
      },
    });
  });
});
