import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const SIDEBAR_LAYOUT_REQUIRED_METHODS = [
  "workspace/ensure",
  "thread/start",
  "thread/name/set",
  "thread/list",
  "thread/read",
  "thread/section/move",
  "threadSection/create",
  "threadSection/list",
];

export const SIDEBAR_LAYOUT_SOURCE_FILES = [
  "src/components/AppSidebar.tsx",
  ...[
    "AppNavigationRail.tsx",
    "AppSidebar.constants.ts",
    "AppSidebar.styles.ts",
    "AppSidebarConversationShelf.tsx",
    "AppSidebarConversationShelf.styles.ts",
    "AppSidebarConversationRow.tsx",
    "AppSidebarLoadMore.tsx",
    "AppSidebarProjectConversationGroups.tsx",
    "AppSidebarSection.tsx",
    "SidebarProfileFooter.tsx",
    "ProfileDropdownItems.tsx",
    "SidebarResizeHandle.tsx",
    "useSidebarWidth.ts",
    "useSidebarSections.ts",
    "useAppSidebarSessions.ts",
    "loadSidebarSessions.ts",
    "sidebarConversationGroups.ts",
    "sidebarSessions.ts",
  ].map((file) => `src/components/app-sidebar/${file}`),
  "src/components/agent/chat/hooks/useOpenedProjectSummaries.ts",
  "src/components/agent/chat/hooks/agentProjectStorage.ts",
  "src/lib/api/threadSections.ts",
  "src/lib/api/agentRuntime/appServerSessionClient.ts",
  "src/lib/api/agentRuntime/sessionClient.ts",
  "src/lib/api/agentRuntime/sessionTypes.ts",
  "src/lib/commands/registry.ts",
  "src/lib/commands/useCommand.ts",
  "src/components/keyboard-shortcuts/KeyboardShortcutsDialog.tsx",
  "src/components/keyboard-shortcuts/KeyboardShortcutsDialogHost.tsx",
  "src/components/app-shell/AppShell.tsx",
  "src/components/settings-v2/_layout/SettingsSidebar.tsx",
  "electron/main.ts",
  "electron/appServerHost.ts",
  "electron/preload.ts",
  "packages/app-server-client/src/request-client.ts",
  "packages/app-server-client/src/request-client-methods.ts",
  "scripts/electron/mcp-config-fixture-smoke.mjs",
  "scripts/electron/lib/persisted-atom-fixture-driver.mjs",
  "scripts/lib/chat-fixture/teardown.mjs",
  "scripts/lib/electron-fixture-build.mjs",
  "scripts/electron/sidebar-layout-fixture-smoke.mjs",
  "scripts/electron/lib/sidebar-layout-fixture-evidence.mjs",
];

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export function fingerprintSources(
  rootDir,
  files = SIDEBAR_LAYOUT_SOURCE_FILES,
) {
  return Object.fromEntries(
    files.map((file) => [
      file,
      sha256(fs.readFileSync(path.join(rootDir, file))),
    ]),
  );
}

export function fingerprintArtifacts(rootDir) {
  const result = {};
  for (const directory of [
    "dist",
    "dist-electron",
    "packages/app-server-client/dist",
  ]) {
    const files = [];
    const visit = (relative) => {
      for (const entry of fs
        .readdirSync(path.join(rootDir, relative), { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const file = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile()) {
          const bytes = fs.readFileSync(path.join(rootDir, file));
          files.push({ file, bytes: bytes.length, sha256: sha256(bytes) });
        }
      }
    };
    visit(directory);
    result[directory] = { treeSha256: sha256(JSON.stringify(files)), files };
  }
  return result;
}

/** Serialized into the real renderer; no text, path or config is returned. */
export function collectSidebarLayoutDom() {
  const find = (testId) => document.querySelector(`[data-testid="${testId}"]`);
  const bounds = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return Object.fromEntries(
      ["x", "y", "width", "height", "right", "bottom"].map((key) => [
        key,
        Math.round(rect[key] * 100) / 100,
      ]),
    );
  };
  const shelf = find("app-sidebar-conversation-shelf");
  const recent = find("app-sidebar-recent-conversations");
  const rows = shelf?.querySelectorAll(
    '[data-testid="app-sidebar-conversation-open"]',
  );
  const menu = find("app-sidebar-account-menu");
  return {
    electron: window.__LIME_ELECTRON__ === true,
    preloadInvoke: typeof window.electronAPI?.invoke === "function",
    fallback: window.electronAPI?.devBridgeFallback !== false,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: document.documentElement.dataset.limeThemeEffective,
    collapsed: find("app-sidebar")?.getAttribute("data-collapsed") === "true",
    sidebar: bounds(find("app-sidebar")),
    rail: bounds(find("app-sidebar-rail")),
    footer: bounds(find("app-sidebar-footer")),
    accountButton: bounds(find("app-sidebar-account-button")),
    menu: bounds(menu),
    menuSide: menu?.getAttribute("data-side") ?? null,
    menuAlign: menu?.getAttribute("data-align") ?? null,
    projectCount:
      shelf?.querySelectorAll(
        '[data-testid="app-sidebar-project-conversation-group"]',
      ).length ?? 0,
    recentCount:
      recent?.querySelectorAll('[data-testid="app-sidebar-conversation-open"]')
        .length ?? 0,
    recentSessionIds: Array.from(
      recent?.querySelectorAll(
        '[data-testid="app-sidebar-conversation-open"]',
      ) ?? [],
      (node) => node.getAttribute("data-session-id"),
    ),
    sectionOrder: Array.from(
      shelf?.querySelectorAll("[data-sidebar-section]") ?? [],
      (node) => node.getAttribute("data-sidebar-section"),
    ),
    rowMetrics: Array.from(rows ?? [], (node) => {
      const style = window.getComputedStyle(node);
      return {
        sessionId: node.getAttribute("data-session-id"),
        height: bounds(node).height,
        minHeight: Number.parseFloat(style.minHeight),
        radius: Number.parseFloat(style.borderRadius),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
      };
    }),
    settingsVisible: Boolean(find("settings-navigation")),
  };
}

export function assertSidebarLayout(
  snapshot,
  { collapsed = false, recentCount = 10 } = {},
) {
  assert.equal(snapshot.electron, true, "real Electron marker");
  assert.equal(snapshot.preloadInvoke, true, "preload invoke bridge");
  assert.equal(snapshot.fallback, false, "renderer mock fallback forbidden");
  assert.equal(snapshot.collapsed, collapsed, "sidebar collapse state");
  assert.equal(snapshot.rail.width, 52, "rail width");
  assert.equal(snapshot.sidebar.width, collapsed ? 52 : 290, "sidebar width");
  assert.ok(
    snapshot.accountButton.bottom <= snapshot.sidebar.bottom &&
      snapshot.sidebar.bottom - snapshot.accountButton.bottom <= 12,
    "account stays at sidebar bottom",
  );
  if (collapsed) return;
  assert.equal(
    snapshot.projectCount,
    5,
    "Projects independent five-item budget",
  );
  assert.equal(snapshot.recentCount, recentCount, "Recents pagination budget");
  assert.ok(snapshot.rowMetrics.length >= 10, "canonical rows rendered");
  for (const row of snapshot.rowMetrics) {
    assert.equal(row.height, 30, "conversation row height");
    assert.equal(row.minHeight, 30, "conversation row min-height");
    assert.equal(row.radius, 10, "conversation row radius");
    assert.equal(row.paddingLeft, 8, "conversation row left padding");
    assert.equal(row.paddingRight, 8, "conversation row right padding");
  }
}

export function assertSidebarMenu(snapshot) {
  assert.equal(snapshot.menuSide, "right", "account menu opens right");
  assert.equal(snapshot.menuAlign, "end", "account menu aligns end");
  assert.ok(snapshot.menu.x >= snapshot.accountButton.right, "right geometry");
  assert.ok(
    Math.abs(snapshot.menu.bottom - snapshot.accountButton.bottom) <= 8,
    "bottom alignment geometry",
  );
}

export function assertSidebarBridge({ rpcReceipts, rendererMethods }) {
  for (const method of SIDEBAR_LAYOUT_REQUIRED_METHODS) {
    const receipt = rpcReceipts.find((entry) => entry.method === method);
    assert.ok(receipt, `missing current method ${method}`);
    assert.equal(receipt.electron, true);
    assert.equal(receipt.fallback, false);
    assert.equal(receipt.command, "app_server_handle_json_lines");
    assert.equal(receipt.transport, "electron-ipc");
    assert.equal(receipt.status, "success");
    assert.equal(receipt.requestId, receipt.responseId);
  }
  for (const method of ["thread/list", "threadSection/list"])
    assert.ok(rendererMethods.includes(method), `GUI did not call ${method}`);
}
