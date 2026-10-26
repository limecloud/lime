import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function isSourceFile(path: string): boolean {
  return Array.from(SOURCE_EXTENSIONS).some((extension) =>
    path.endsWith(extension),
  );
}

function isAllowedTestOnlyPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    /\.test\.[cm]?[tj]sx?$/.test(normalized) ||
    /\.unit\.test\.[cm]?[tj]sx?$/.test(normalized) ||
    /\.testFixtures\.[cm]?[tj]sx?$/.test(normalized)
  );
}

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (stat.isFile() && isSourceFile(path)) {
      files.push(path);
    }
  }
  return files;
}

describe("pluginFixtureBoundary", () => {
  it("旧插件 token、空 mock 与独立 Connector 交付链不得回流", () => {
    const retiredPaths = [
      "lime-rs/crates/core/src/plugin_runtime_token.rs",
      "src/lib/desktop-host/pluginMocks.ts",
      "src/lib/desktop-host/pluginMocks.d.ts",
      "src/lib/desktop-host/pluginMocks.test.ts",
      "src/features/plugin/testing",
      "src/features/plugin/adapters",
      "src/features/plugin/install",
      "scripts/plugin",
      "packages/agent-runtime-projection/src/pluginCapabilityRuntime.ts",
      "packages/agent-runtime-projection/tests/pluginCapabilityRuntime.test.mjs",
      "src/components/agent/chat/workspace/workspacePluginPaneAction.ts",
      "src/components/agent/chat/workspace/workspacePluginPaneAction.unit.test.ts",
      "src/components/agent/chat/workspace/WorkspaceArticleWorkspaceRendererHost.tsx",
      "src/components/agent/chat/workspace/workspaceArticleWorkspaceRendererHostModel.ts",
      "src/components/agent/chat/workspace/workspaceArticleWorkspaceRendererHostPolicy.ts",
      "src/components/agent/chat/workspace/workspaceArticleWorkspaceRendererHostPolicy.unit.test.ts",
      ...["preflight", "delivery-gate", "webhook-delivery"].flatMap((name) => [
        `scripts/lib/plugin-connector-production-${name}-core.mjs`,
        `scripts/lib/plugin-connector-production-${name}-core.test.mjs`,
      ]),
    ];
    expect(
      retiredPaths.filter((path) => existsSync(join(REPO_ROOT, path))),
    ).toEqual([]);

    const host = readFileSync(
      join(SRC_ROOT, "lib/desktop-host/core.ts"),
      "utf8",
    );
    expect(host).not.toContain("pluginMocks");
    const projectionExports = readFileSync(
      join(REPO_ROOT, "packages/agent-runtime-projection/src/index.ts"),
      "utf8",
    );
    expect(projectionExports).not.toContain("pluginCapabilityRuntime");
    const articleAction = readFileSync(
      join(
        SRC_ROOT,
        "components/agent/chat/workspace/workspaceArticleWorkspaceActionRequestMetadata.ts",
      ),
      "utf8",
    );
    expect(articleAction).not.toMatch(/workspacePluginPaneAction|pane_action/);
    for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]) {
      const messages = JSON.parse(
        readFileSync(
          join(SRC_ROOT, `i18n/resources/${locale}/workspace.json`),
          "utf8",
        ),
      );
      expect(Object.keys(messages), locale).not.toEqual(
        expect.arrayContaining([expect.stringContaining(".rendererHost.")]),
      );
      expect(
        messages["workspace.articleEditor.actions.title"],
        locale,
      ).toBeTruthy();
    }
    for (const path of [
      "runtime/turn_execution.rs",
      "runtime/workflow/cancel.rs",
      "runtime/workflow/control.rs",
    ]) {
      const source = readFileSync(
        join(REPO_ROOT, "lime-rs/crates/app-server/src", path),
        "utf8",
      );
      expect(source, path).not.toMatch(
        /pluginWorkflow|plugin_workflow|workerLifecycle|worker_lifecycle/,
      );
    }
    const pluginProtocol = readFileSync(
      join(
        REPO_ROOT,
        "lime-rs/crates/app-server-protocol/src/protocol/v2/plugin.rs",
      ),
      "utf8",
    );
    expect(pluginProtocol).not.toContain("PluginCatalog");
    expect(pluginProtocol).not.toMatch(
      /pub\s+(source_path|expected_digest|source_uri|skills_count|mcp_servers_count|ui_resources)\s*:/,
    );
    expect(pluginProtocol).not.toMatch(/pub\s+uninstalled\s*:/);
    const gateway = readFileSync(
      join(SRC_ROOT, "lib/api/pluginCatalog.ts"),
      "utf8",
    );
    expect(gateway).not.toContain("selectPluginCatalogSource");
    expect(gateway).not.toContain("desktop-host/dialog");
    const cloudRuntime = readFileSync(
      join(SRC_ROOT, "lib/api/oemCloudRuntime.ts"),
      "utf8",
    );
    expect(cloudRuntime).not.toMatch(
      /PluginSignature|pluginSignatureTrustRoots|plugin_signature_trust_roots/,
    );
    const discovery = readFileSync(
      join(
        REPO_ROOT,
        "lime-rs/crates/app-server/src/local_data_source/plugin_catalog/discovery.rs",
      ),
      "utf8",
    );
    expect(discovery).not.toContain('store.root.join("marketplaces")');
    const hookDiscovery = readFileSync(
      join(REPO_ROOT, "lime-rs/crates/tool-runtime/src/hook_discovery.rs"),
      "utf8",
    );
    expect(hookDiscovery).not.toMatch(
      /plugin_sources_from_activations|packageSourceUri|package_source_uri/,
    );
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    );
    expect(
      Object.keys(manifest.scripts).filter((name) =>
        name.startsWith("plugin:connector-production-"),
      ),
    ).toEqual([]);
    const api = readFileSync(
      join(REPO_ROOT, "lime-rs/crates/server/src/handlers/api.rs"),
      "utf8",
    );
    expect(api).not.toMatch(
      /plugin_runtime_token|verify_model_generation_api_key/,
    );
    const surfaceModel = readFileSync(
      join(
        SRC_ROOT,
        "components/agent/chat/workspace/workspacePluginSurfaceModel.ts",
      ),
      "utf8",
    );
    expect(surfaceModel).not.toMatch(
      /FromPendingRequest|entryUrl|controlledBrowserWindow|supportedStrategies|sourceRequestId/,
    );
    const surfaceHost = readFileSync(
      join(
        SRC_ROOT,
        "components/agent/chat/workspace/WorkspacePluginSurface.tsx",
      ),
      "utf8",
    );
    expect(surfaceHost).not.toMatch(/entryUrl|navigateEmbeddedBrowserView/);
    const sessionIdentity = readFileSync(
      join(SRC_ROOT, "lib/api/agentRuntime/sessionIdentity.ts"),
      "utf8",
    );
    expect(sessionIdentity).not.toContain("plugin-runtime-");
  });

  it("生产源码不得恢复 Plugin fixture 目录或导入 test-only fixture", () => {
    const violations = listSourceFiles(SRC_ROOT)
      .filter((path) => !isAllowedTestOnlyPath(path))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const relativePath = relative(REPO_ROOT, path);
        return [
          source.includes("features/plugin/fixtures")
            ? `${relativePath}: legacy fixture path`
            : null,
          source.includes("plugin/testing/fixtures") ||
          source.includes("../testing/fixtures") ||
          source.includes("./fixtures/content-factory-app.json")
            ? `${relativePath}: test-only fixture import`
            : null,
          /VITE_LIME_PLUGIN_|rendererContract|renderer_contract|app_declared_renderer_placeholder_only|host_placeholder_only|articleWorkspace\.rendererHost/.test(
            source,
          )
            ? `${relativePath}: retired plugin renderer host`
            : null,
        ].filter((value): value is string => Boolean(value));
      });

    expect(violations).toEqual([]);
  });
});
