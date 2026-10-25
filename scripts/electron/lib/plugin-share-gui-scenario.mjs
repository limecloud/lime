import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { withNativeClipboard } from "./native-clipboard.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../mcp-config-fixture-smoke.mjs";

export function preparePluginShareDraft(home) {
  const root = path.join(home, "plugins/draft");
  fs.mkdirSync(path.join(root, ".lime-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".lime-plugin/plugin.json"),
    JSON.stringify({ name: "draft", version: "1.0.0" }),
  );
  fs.writeFileSync(path.join(root, ".hidden"), "draft private marker\n");
  const marketplace = path.join(home, ".agents/plugins/marketplace.json");
  fs.mkdirSync(path.dirname(marketplace), { recursive: true });
  fs.writeFileSync(
    marketplace,
    JSON.stringify({
      name: "codex-curated",
      interface: { displayName: "Personal" },
      plugins: [
        { name: "draft", source: { source: "local", path: "./plugins/draft" } },
      ],
    }),
  );
  return root;
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

export async function exercisePluginShareGui({
  handle,
  summary,
  baseUrl,
  draftRoot,
  evidenceDir,
}) {
  const { page, app } = handle;
  await page
    .locator(
      '[data-testid="app-sidebar-nav-plugins"]',
    )
    .click();
  await page
    .locator('[data-testid="plugin-catalog-share-draft@codex-curated"]')
    .click();
  await page.locator('[data-testid="plugin-share-create"]').click();
  await page.locator('[data-testid="plugin-share-update"]').waitFor();
  assert.equal(summary.share.finalized.length, 1);
  assert.equal(summary.share.finalized[0].discoverability, "PRIVATE");
  assert.equal(summary.share.finalized[0].update, false);
  const access = page.locator('[data-testid="plugin-share-access"]');
  await access.selectOption("UNLISTED");
  assert.equal(
    await page.locator('[data-testid="plugin-share-copy"]').isDisabled(),
    true,
  );
  await page.locator('[data-testid="plugin-share-save-access"]').click();
  await waitUntil(
    async () =>
      summary.share.access.length === 1 &&
      (await page
        .locator('[data-testid="plugin-share-save-access"]')
        .isDisabled()),
    "sharing ACL must commit and clear the draft",
  );
  assert.deepEqual(summary.share.access[0], {
    discoverability: "UNLISTED",
    targets: [
      {
        principal_type: "workspace",
        principal_id: "checkout-fixture",
        role: "reader",
      },
    ],
  });
  await withNativeClipboard(app, async () => {
    await app.evaluate(({ clipboard }) =>
      clipboard.writeText("PLUGIN_SHARE_COPY_SENTINEL"),
    );
    await page.locator('[data-testid="plugin-share-copy"]').click();
    const expected = `${baseUrl}/share/opaque~draft`;
    await waitUntil(
      async () =>
        (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
        expected,
      "native clipboard must contain the complete share URL",
    );
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    summary.checks.nativeShareClipboard = {
      exact: copied === expected,
      length: copied.length,
      sha256: createHash("sha256").update(copied).digest("hex"),
    };
  });
  fs.appendFileSync(
    path.join(draftRoot, ".hidden"),
    "updated private marker\n",
  );
  await page.locator('[data-testid="plugin-share-update"]').click();
  await waitUntil(
    async () =>
      summary.share.finalized.length === 2 &&
      (await page.locator('[data-testid="plugin-share-update"]').isEnabled()),
    "same-ID update must finish",
  );
  assert.equal(summary.share.finalized[1].update, true);
  assert.equal(summary.share.finalized[1].discoverability, undefined);
  assert.equal(summary.share.uploads[1].hasUpdatedMarker, true);
  await page.screenshot({
    path: path.join(evidenceDir, "share-management.png"),
  });
  await page.locator('[data-testid="plugin-share-delete"]').click();
  assert.equal(summary.share.deleted, false);
  await page.locator('[data-testid="plugin-share-confirm-delete"]').click();
  await page
    .locator('[data-testid="plugin-share-dialog"]')
    .waitFor({ state: "detached" });
  assert.equal(summary.share.deleted, true);
  assert(
    fs
      .readFileSync(path.join(draftRoot, ".hidden"), "utf8")
      .includes("updated private marker"),
  );
  await page
    .locator(
      '[data-testid="plugin-catalog-share-research-0@workspace-shared-with-me"]',
    )
    .click();
  await page.locator('[data-testid="plugin-share-checkout"]').click();
  await page.locator('[data-testid="plugin-share-local-path"]').waitFor();
  const pluginPath = await page
    .locator('[data-testid="plugin-share-local-path"]')
    .textContent();
  assert.equal(
    pluginPath,
    path.join(
      fs.realpathSync(path.join(draftRoot, "../..")),
      "plugins/research-0",
    ),
  );
  await page.screenshot({ path: path.join(evidenceDir, "share-checkout.png") });
  await page.keyboard.press("Escape");
  await page
    .locator('[data-testid="plugin-share-dialog"]')
    .waitFor({ state: "detached" });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "plugin-catalog-share-research-0@workspace-shared-with-me",
  );
  summary.checks.shareGui = {
    privateCreate: true,
    serverAccessSaved: true,
    sameIdUpdate: true,
    revocationConfirmed: true,
    editsRetained: true,
    checkoutFromCatalog: true,
  };
  const calls = parseJsonRpcRequestsFromInvokeTrace(
    await page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ),
  ).filter(
    (call) =>
      call.method.startsWith("plugin/share/") && call.status === "success",
  );
  for (const method of ["save", "list", "updateTargets", "delete", "checkout"])
    assert(
      calls.some((call) => call.method === `plugin/share/${method}`),
      `GUI must use ${method}`,
    );
  assert(calls.every((call) => call.transport === "electron-ipc"));
  summary.checks.shareGuiRpc = [...new Set(calls.map((call) => call.method))];
  summary.shareGuiEntry = true;
}
