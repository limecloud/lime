import type { AppServerPluginDetail } from "@/lib/api/appServerTypes";

export function skillPreviewDetail(
  path: string | null = null,
): AppServerPluginDetail {
  return {
    marketplaceName: "workspace-directory",
    marketplacePath: null,
    summary: {
      id: "research@workspace-directory",
      remotePluginId: "opaque~1",
      name: "research",
      version: "1.0.0",
      localVersion: null,
      source: { type: "remote" },
      installed: false,
      enabled: false,
      installPolicy: "AVAILABLE",
      authPolicy: "ON_USE",
    },
    description: "Research plugin",
    onboardingSkill: null,
    skills: [
      {
        name: "research",
        description: "Research topics",
        shortDescription: null,
        interface: { displayName: "Researcher" },
        path,
        enabled: false,
      },
    ],
    hooks: [],
    apps: [],
    appTemplates: [],
    mcpServers: [],
    scheduledTasks: null,
  };
}
