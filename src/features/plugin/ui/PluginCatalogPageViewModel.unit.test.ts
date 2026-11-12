import { describe, expect, it } from "vitest";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import {
  detailCapabilityCount,
  filterPluginCatalog,
  pluginCatalogEntries,
  pluginLocation,
  projectPluginCatalogApps,
} from "./PluginCatalogPageViewModel";

function summary(
  id: string,
  overrides: Partial<AppServerPluginSummary> = {},
): AppServerPluginSummary {
  return {
    authPolicy: "ON_USE",
    availability: "AVAILABLE",

    enabled: true,
    id,
    installPolicy: "AVAILABLE",
    installed: true,
    localVersion: "1.0.0",
    name: id,
    source: { type: "local", path: "/tmp/writer-plugin" },
    version: "1.0.0",
    ...overrides,
  };
}

describe("PluginCatalogPageViewModel", () => {
  it("按视图、来源和查询过滤同一 catalog projection", () => {
    const plugins = [
      summary("writer", { name: "Writing Tools" }),
      summary("browser", {
        installed: false,
        source: { type: "local", path: "/plugins/browser" },
        name: "Browser Tools",
      }),
    ];

    const entries = pluginCatalogEntries([
      { name: "personal", path: "/tmp/personal.json", plugins: [plugins[0]] },
      { name: "bundled", path: "/tmp/bundled.json", plugins: [plugins[1]] },
    ]);
    expect(
      filterPluginCatalog(entries, {
        query: "writing",
        source: "personal",
        view: "installed",
      }).map(({ plugin }) => plugin.id),
    ).toEqual(["writer"]);
    expect(pluginLocation(entries[0])).toEqual({
      pluginName: "Writing Tools",
      marketplacePath: "/tmp/personal.json",
    });
    expect(
      pluginLocation({
        ...entries[0],
        plugin: {
          ...plugins[0],
          remotePluginId: "opaque_writer~1",
          source: { type: "remote" },
        },
        marketplace: {
          ...entries[0].marketplace,
          name: "workspace-directory",
          path: null,
        },
      }),
    ).toEqual({
      pluginName: "opaque_writer~1",
      remoteMarketplaceName: "workspace-directory",
    });
  });

  it.each([undefined, "", "writer@workspace-directory", "../writer"])(
    "远端 ID %s 无效时拒绝退回名称",
    (remotePluginId) => {
      expect(() =>
        pluginLocation({
          marketplace: { name: "workspace-directory", path: null, plugins: [] },
          plugin: summary("writer@workspace-directory", {
            name: "writer",
            remotePluginId,
          }),
        }),
      ).toThrow();
    },
  );

  it("详情能力由 typed detail 统计", () => {
    expect(
      detailCapabilityCount({
        marketplaceName: "personal",
        marketplacePath: "/tmp/personal.json",
        summary: summary("writer"),
        description: null,
        skills: [{ name: "skill", description: "", enabled: true }],
        mcpServers: ["server"],
        apps: [
          {
            id: "app",
            name: "App",
            description: null,
            category: null,
            installUrl: null,
          },
        ],
        hooks: [],
        appTemplates: [],
        scheduledTasks: null,
      }),
    ).toBe(3);
  });

  it("将 Apps catalog 与 installed snapshot 投影为 fail-closed readiness", () => {
    const capabilities = [
      {
        id: "writer",
        name: "Writer",
        description: null,
        installUrl: null,
        category: null,
      },
      {
        id: "disabled",
        name: "Disabled",
        description: null,
        installUrl: null,
        category: null,
      },
      {
        id: "missing",
        name: "Missing",
        description: null,
        installUrl: null,
        category: null,
      },
    ];
    const catalog = capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: null,
      logoUrl: null,
      logoUrlDark: null,
      iconAssets: null,
      iconDarkAssets: null,
      distributionChannel: "local",
      branding: null,
      appMetadata: null,
      labels: null,
      installUrl: null,
      isAccessible: true,
      isEnabled: true,
      pluginDisplayNames: ["Writer Plugin"],
    }));

    expect(
      projectPluginCatalogApps(capabilities, catalog, [
        {
          id: "writer",
          runtimeName: "Writer",
          enabled: true,
          callable: true,
        },
        {
          id: "disabled",
          runtimeName: "Disabled",
          enabled: false,
          callable: false,
        },
      ]),
    ).toEqual([
      {
        callable: true,
        enabled: true,
        id: "writer",
        name: "Writer",
        status: "ready",
      },
      {
        callable: false,
        enabled: false,
        id: "disabled",
        name: "Disabled",
        status: "disabled",
      },
      {
        callable: false,
        enabled: true,
        id: "missing",
        name: "Missing",
        status: "pending",
      },
    ]);
  });
});
