import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  assert,
  sleep,
  sanitizeText,
} from "./claw-chat-current-fixture-utils.mjs";

async function waitFor(options, read, predicate, label) {
  const until = Date.now() + Math.min(options.timeoutMs, 20000);
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await sleep(100);
  } while (Date.now() < until);
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function nativePrompt(app, operation = "read") {
  return app.evaluate(async ({ webContents }, operation) => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !wc.getURL().startsWith("data:text/html"))
        continue;
      const state = await wc.executeJavaScript(`(() => {
        const dialog = document.querySelector('[role="alertdialog"]');
        if (!dialog || !window.browserMenu) return null;
        const operation = ${JSON.stringify(operation)};
        const snapshot = { title: dialog.querySelector('h1').textContent,
          description: dialog.querySelector('p').textContent,
          focused: document.activeElement?.dataset?.id,
          buttons: [...dialog.querySelectorAll('button')].map(b => ({id:b.dataset.id,label:b.textContent})) };
        if (operation === 'escape') document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        if (operation === 'confirm' || operation === 'cancel') dialog.querySelector('[data-id="'+operation+'"]').click();
        return snapshot;
      })()`);
      if (state) {
        if (operation === "capture")
          state.png = (await wc.capturePage()).toPNG().toString("base64");
        return state;
      }
    }
    return null;
  }, operation);
}

/** Real page Web MIDI request, with no enumeration or operations on physical devices. */
export async function runBrowserSitePermissionsScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const flows = [];
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><meta charset="utf-8"><title>Site permission fixture</title>
      <h1>Site permission fixture</h1><button id="request">Request MIDI system exclusive permission</button><output id="result">idle</output>
      <script>
      window.permissionFixture={status:'idle'};
      document.querySelector('#request').onclick=()=>{
        window.permissionFixture.status='pending';
        navigator.requestMIDIAccess({sysex:true}).then(()=>{
          window.permissionFixture.status='allowed';document.querySelector('#result').textContent='allowed';
        },error=>{window.permissionFixture.status='denied';window.permissionFixture.error=error.name;document.querySelector('#result').textContent='denied';});
      };
      </script>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const webContentsId = guiBeforeTurn.webContentsId;
  const readPage = () =>
    app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      return {
        id: wc.id,
        url: wc.getURL(),
        loading: wc.isLoading(),
        state: await wc.executeJavaScript(
          `(async()=>({fixture:window.permissionFixture??null,check:await navigator.permissions.query({name:'midi',sysex:true}).then(s=>s.state).catch(e=>e.name)}))()`,
        ),
      };
    }, webContentsId);
  const navigate = async (name) => {
    const url = `${origin}/${name}`;
    const address = page.locator('[data-testid="browser-workspace-address"]');
    await address.fill(url);
    await address.press("Enter");
    await waitFor(
      options,
      readPage,
      (value) =>
        value.url === url &&
        !value.loading &&
        value.state.fixture?.status === "idle",
      `navigation ${name}`,
    );
  };
  const request = () =>
    app.evaluate(async ({ webContents }, id) => {
      await webContents
        .fromId(id)
        .executeJavaScript(
          "document.querySelector('#request').click();undefined",
          true,
        );
    }, webContentsId);
  try {
    const profile = await app.evaluate(({ app }) => ({
      path: app.getPath("userData"),
      requested: process.env.ELECTRON_E2E_USER_DATA_DIR,
      e2e: process.env.LIME_ELECTRON_E2E,
    }));
    assert(
      profile.e2e === "1" && profile.path === profile.requested,
      "Requires the existing isolated fixture Profile",
    );
    assertions.isolatedProfile = true;
    for (const decision of ["confirm", "cancel", "escape"]) {
      await navigate(decision);
      const before = await readPage();
      assert(
        before.state.check !== "granted",
        "A fresh document inherited a MIDI grant",
      );
      await request();
      const prompt = await waitFor(
        options,
        () => nativePrompt(app),
        Boolean,
        `native prompt ${decision}`,
      );
      assert(
        prompt.description.includes(origin) &&
          prompt.description.includes("MIDI"),
        "Prompt did not disclose native request source and permission",
      );
      assert(
        prompt.focused === "cancel",
        "Confirmation must initially focus denial",
      );
      if (decision === "confirm") {
        const capture = await nativePrompt(app, "capture");
        await fs.writeFile(
          path.join(path.dirname(options.output), "site-permission-prompt.png"),
          Buffer.from(capture.png, "base64"),
        );
      }
      await nativePrompt(app, decision);
      const outcome = await waitFor(
        options,
        readPage,
        (value) => value.state.fixture?.status !== "pending",
        `permission outcome ${decision}`,
      );
      const expected = decision === "confirm" ? "allowed" : "denied";
      assert(
        outcome.state.fixture.status === expected,
        `Wrong ${decision} outcome`,
      );
      assert(
        decision !== "confirm" || outcome.state.check === "granted",
        "Approved request/check disagree",
      );
      await waitFor(
        options,
        () => nativePrompt(app),
        (value) => value === null,
        "prompt retired",
      );
      flows.push({
        decision,
        before: before.state,
        prompt,
        outcome: outcome.state,
      });
      assertions[decision] = true;
    }
    await navigate("navigation-cancel");
    await request();
    await waitFor(
      options,
      () => nativePrompt(app),
      Boolean,
      "prompt before page navigation",
    );
    await app.evaluate(
      async ({ webContents }, { id, url }) => {
        await webContents
          .fromId(id)
          .executeJavaScript(`location.href=${JSON.stringify(url)};undefined`);
      },
      { id: webContentsId, url: `${origin}/after-navigation` },
    );
    await waitFor(
      options,
      readPage,
      (value) =>
        value.url === `${origin}/after-navigation` &&
        value.state.fixture?.status === "idle",
      "page navigation",
    );
    await waitFor(
      options,
      () => nativePrompt(app),
      (value) => value === null,
      "navigation revoked prompt",
    );
    assertions.navigationRevokedPrompt =
      (await readPage()).state.check !== "granted";
    const gui = await readBrowserWorkspaceState(page);
    assertions.sameNativeTab =
      gui.webContentsId === webContentsId && gui.tabId === guiBeforeTurn.tabId;
    assertions.noStaleAgentPermissionBanner =
      (await page
        .locator('[data-testid="browser-workspace-permission"]')
        .count()) === 0;
    const trace = readInvokeTrace();
    assertions.productionBridge = trace.some(
      (entry) =>
        entry.command === "app_server_handle_json_lines" &&
        entry.transport === "electron-ipc",
    );
    assertions.noMockFallback = !trace.some(
      (entry) => entry.transport === "mock" || entry.fallback === true,
    );
    const hiddenHost = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence ?? null,
    );
    assertions.realHiddenHost =
      hiddenHost?.visibilityOnly === true &&
      hiddenHost.unexpectedShowEvents === 0 &&
      hiddenHost.preloadErrors.length === 0;
    return {
      scenario: "site-permissions",
      input: "synthetic DOM in real native WCV",
      assertions,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      flows,
      webContentsId,
      diagnostics: { hiddenHost },
    };
  } catch (error) {
    await fs.writeFile(
      options.output,
      JSON.stringify(
        {
          scenario: "site-permissions",
          status: "fail",
          assertions,
          flows,
          error: sanitizeText(error),
          page: await readPage().catch(() => null),
          prompt: await nativePrompt(app).catch(() => null),
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
