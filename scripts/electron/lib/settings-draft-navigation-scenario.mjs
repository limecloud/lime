import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  appServerCallFromPage,
  openMcpConfigSettings,
  readConfigFromPage,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { isObservedPreloadAppServerResponse } from "./mcp-config-fixture-evidence.mjs";

export const SETTINGS_DRAFT_FIXTURE_SOURCES = [
  "scripts/electron/settings-mcp-lifecycle-fixture-smoke.mjs",
  "scripts/electron/mcp-config-fixture-smoke.mjs",
  "scripts/electron/lib/settings-draft-navigation-scenario.mjs",
  "scripts/electron/lib/settings-mcp-lifecycle-fixture-evidence.mjs",
  "scripts/electron/lib/mcp-config-fixture-evidence.mjs",
  "scripts/electron/lib/persisted-atom-fixture-driver.mjs",
  "scripts/lib/chat-fixture/teardown.mjs",
  "scripts/lib/electron-fixture-build.mjs",
  "src/components/settings-v2/integrations/plugins/index.tsx",
  "src/components/settings-v2/integrations/plugins/McpServerManager.tsx",
  "src/components/settings-v2/integrations/plugins/McpServerDetail.tsx",
  "src/components/settings-v2/integrations/plugins/McpServerFields.tsx",
  "src/components/settings-v2/integrations/plugins/mcpServerConfig.ts",
  "src/components/settings-v2/integrations/plugins/useMcpSettings.ts",
  "src/lib/api/mcp.ts",
  "src/components/settings-v2/_layout/SettingsUnsavedChangesDialog.tsx",
  "src/components/settings-v2/_layout/useSettingsDraft.ts",
  "src/lib/api/appConfig.ts",
];

export function captureSettingsDraftFixtureSources(rootDir) {
  return SETTINGS_DRAFT_FIXTURE_SOURCES.map((file) => ({
    file,
    sha256: createHash("sha256")
      .update(fs.readFileSync(path.join(rootDir, file)))
      .digest("hex"),
  }));
}

export function observeSettingsDraftReadback(response, method) {
  assert.equal(
    isObservedPreloadAppServerResponse(response?.ipcObservation, method),
    true,
    "draft readback requires current preload IPC and matching JSON-RPC identity",
  );
  // Do not retain params, request IDs, configuration, or server data.
  return {
    method,
    transport: "electron-ipc",
    matchingRequestResponse: true,
    currentPreload: true,
  };
}

export function settingsDraftNavigationChecks(kind, proof) {
  assert.ok(kind === "mcp", "known draft scenario");
  const required = [
    "sectionKeep",
    "sectionDiscard",
    "keepDefaultFocus",
    "unpersistedDraft",
  ];
  required.push("sameServerIdentity", "cancelKeep", "cancelDiscard");
  const method = "mcpServer/list";
  return [
    ...required.map((key) => [`${kind}Draft.${key}`, proof?.[key] === true]),
    [
      `${kind}Draft.currentReadbackIdentity`,
      Array.isArray(proof?.readbacks) &&
        proof.readbacks.length >= 3 &&
        proof.readbacks.every(
          (value) =>
            value?.method === method &&
            value.transport === "electron-ipc" &&
            value.currentPreload === true &&
            value.matchingRequestResponse === true,
        ),
    ],
  ];
}

export function summarizeSettingsDraftProof(kind, proof) {
  const values = Object.fromEntries(
    settingsDraftNavigationChecks(kind, proof)
      .filter(([key]) => !key.endsWith(".currentReadbackIdentity"))
      .map(([key, passed]) => [key.slice(key.indexOf(".") + 1), passed]),
  );
  const method = "mcpServer/list";
  return {
    ...values,
    readbacks: Array.isArray(proof?.readbacks)
      ? proof.readbacks.map((item) => ({
          method: item?.method === method ? method : null,
          transport: item?.transport === "electron-ipc" ? "electron-ipc" : null,
          currentPreload: item?.currentPreload === true,
          matchingRequestResponse: item?.matchingRequestResponse === true,
        }))
      : [],
  };
}

export function settingsDraftNativeChecks(facts, launchCount) {
  return [
    [
      "normalMainExits",
      Array.isArray(facts.normalMainExits) &&
        facts.normalMainExits.length === launchCount &&
        facts.normalMainExits.every(
          (exit) =>
            exit?.exited === true &&
            exit.exitCode === 0 &&
            exit.signal === null &&
            exit.mode === "normal" &&
            exit.forcedCleanup === false,
        ),
    ],
    [
      "buildFreshnessBeforeAfter",
      facts.buildFreshness?.before?.ready === true &&
        facts.buildFreshness?.after?.ready === true,
    ],
    [
      "declaredSourcesStable",
      Array.isArray(facts.sourceManifest?.before) &&
        facts.sourceManifest.before.length ===
          SETTINGS_DRAFT_FIXTURE_SOURCES.length &&
        facts.sourceManifest.before.every(
          (item, index) =>
            item.file === SETTINGS_DRAFT_FIXTURE_SOURCES[index] &&
            /^[a-f0-9]{64}$/.test(item.sha256),
        ) &&
        isDeepStrictEqual(
          facts.sourceManifest.before,
          facts.sourceManifest.after,
        ),
    ],
  ];
}

function unsavedDialog(page) {
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  return {
    dialog,
    keep: dialog.getByRole("button", { name: "继续编辑", exact: true }),
    discard: dialog.getByRole("button", { name: "放弃更改", exact: true }),
  };
}

async function keepThenDiscard({
  page,
  field,
  trigger,
  changed,
  verifyUnchanged,
}) {
  const { dialog, keep, discard } = unsavedDialog(page);
  await trigger.click();
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await keep.evaluate((element) => element === document.activeElement),
    true,
  );
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await field.inputValue(), changed);
  await verifyUnchanged();
  await trigger.click();
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  await dialog.waitFor({ state: "detached" });
  await verifyUnchanged();
}

async function assertAbout(page, options) {
  await waitForPageCondition(
    page,
    options,
    () =>
      document
        .querySelector('[data-testid="settings-sidebar-tab-about"]')
        ?.getAttribute("aria-current") === "page" &&
      !document.querySelector('[data-testid="settings-page-loading"]'),
    "draft discard committed the real About navigation",
  );
}

export async function runMcpDraftNavigationScenario({
  page,
  options,
  server,
  selectServer,
}) {
  assert.equal(typeof server?.id, "string");
  assert.ok(server.id);
  const readbacks = [];
  const verifyUnchanged = async () => {
    const response = await appServerCallFromPage(page, "mcpServer/list", {});
    readbacks.push(observeSettingsDraftReadback(response, "mcpServer/list"));
    const current = response.result?.servers?.find(
      (item) => item.id === server.id,
    );
    assert.equal(
      isDeepStrictEqual(current, server),
      true,
      "same MCP server remains unchanged before GUI save",
    );
  };
  const field = page.getByTestId("mcp-config-connection-url");
  const changed = "https://draft.invalid/unsaved";
  await selectServer();
  await field.fill(changed);
  await keepThenDiscard({
    page,
    field,
    changed,
    trigger: page.getByTestId("mcp-config-cancel"),
    verifyUnchanged,
  });
  await field.waitFor({ state: "detached" });
  await selectServer();
  assert.equal(await field.inputValue(), server.server_config.url);
  await field.fill(changed);
  await keepThenDiscard({
    page,
    field,
    changed,
    trigger: page.getByTestId("settings-sidebar-tab-about"),
    verifyUnchanged,
  });
  await assertAbout(page, options);
  await openMcpConfigSettings(page, options);
  await selectServer();
  assert.equal(await field.inputValue(), server.server_config.url);
  return {
    sectionKeep: true,
    sectionDiscard: true,
    keepDefaultFocus: true,
    unpersistedDraft: true,
    sameServerIdentity: true,
    cancelKeep: true,
    cancelDiscard: true,
    readbacks,
  };
}
