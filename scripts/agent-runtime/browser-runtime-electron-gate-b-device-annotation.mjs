import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assert, sanitizeText } from "../lib/chat-fixture/utils.mjs";
import {
  observeBrowserAnnotationInputs,
  readBrowserAnnotationCommands,
  readBrowserAnnotationNativeIdentity,
  waitForBrowserAnnotationNativePage,
  waitForBrowserAnnotationState,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { browserDeviceAnnotationAssertions } from "./browser-device-annotation-evidence.mjs";

/** Real native input to the current WCV; no injected selection, draft, capture or acceptance. */
export async function runBrowserDeviceAnnotationScenario(ctx) {
  const { app, page, options, guiBeforeTurn } = ctx;
  page.setDefaultTimeout(Math.min(20000, options.timeoutMs));
  const output = path.dirname(options.output);
  const key = `__deviceAnnotation_${randomUUID().replaceAll("-", "")}`;
  const wait = (read, predicate, description) =>
    waitForBrowserAnnotationState(
      {
        ...options,
        timeoutMs: Math.min(options.timeoutMs, 20000),
        intervalMs: 100,
      },
      read,
      predicate,
      description,
    );
  const labels = {};
  for (const name of ["browserAnnotation", "browserChrome", "settings"])
    labels[name] = JSON.parse(
      await fs.readFile(
        new URL(
          `../../src/i18n/resources/${options.locale}/${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const label = (namespace, name) => labels[namespace][`${namespace}.${name}`];
  const click = (locator) => locator.evaluate((node) => node.click());
  const toolbar = page.getByTestId("browser-device-toolbar");
  const button = (name) =>
    toolbar.getByRole("button", {
      name: label("browserChrome", name),
      exact: true,
    });
  const preset = toolbar.getByRole("combobox", {
    name: label("browserChrome", "device"),
    exact: true,
  });
  const readState = () =>
    page.evaluate(async (scope) => {
      const tabs = await window.electronAPI.invoke("browser_tab_list", {
        browserSessionId: scope.sessionId,
        threadId: scope.threadId,
      });
      return tabs.find((tab) => tab.tabId === scope.tabId);
    }, guiBeforeTurn);
  const evidence = {
    scenario: "device-annotation",
    status: "fail",
    cells: [],
    assertions: {},
    pid: app.process().pid,
    physicalInput: false,
    agentTurn: false,
    input:
      "Native WebContents.sendInputEvent; renderer/editor DOM actions in hidden real Electron",
    claimBoundary:
      "Device and annotation native coordinate slice; no Agent turn, physical OS input, reference pixel match or packaged platform claim",
    screenshots: [],
    diagnostics: { consoleErrors: [], pageErrors: [] },
  };
  const observed = new Set();
  const observe = (target) => {
    if (observed.has(target)) return;
    observed.add(target);
    target.on("console", (message) => {
      if (message.type() === "error")
        evidence.diagnostics.consoleErrors.push(message.text());
    });
    target.on("pageerror", (error) =>
      evidence.diagnostics.pageErrors.push(String(error)),
    );
  };
  let native;
  const metrics = () =>
    native.page.evaluate(() => ({
      innerWidth,
      innerHeight,
      dpr: devicePixelRatio,
      visualViewport: {
        width: visualViewport.width,
        height: visualViewport.height,
        scale: visualViewport.scale,
      },
      rect: document
        .getElementById("device-annotation-target")
        .getBoundingClientRect()
        .toJSON(),
      clicks: globalThis.__deviceAnnotationClicks,
      node: typeof require,
      bridge: typeof window.electronAPI,
    }));
  const measure = async () => ({
    state: await readState(),
    metrics: await metrics(),
    native: await readBrowserAnnotationNativeIdentity(
      app,
      guiBeforeTurn.webContentsId,
    ),
    nativeZoom: await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id).getZoomFactor(),
      guiBeforeTurn.webContentsId,
    ),
  });
  const settledMeasure = async (zoom) => {
    let previous = "",
      count = 0;
    return wait(
      measure,
      (value) => {
        const next = JSON.stringify(value);
        count = next === previous ? count + 1 : 0;
        previous = next;
        const projected = value.state.deviceViewport?.bounds;
        const matches =
          !projected ||
          ["x", "y", "width", "height"].every(
            (key) => projected[key] === value.native.bounds[key],
          );
        return (
          count >= 2 &&
          matches &&
          value.state.zoomFactor === zoom &&
          value.nativeZoom === zoom
        );
      },
      "Native and projected geometry did not settle together",
    );
  };
  const screenshot = async (id, name) => {
    const png = await app.evaluate(async ({ webContents }, id) => {
      const image = await webContents
        .fromId(id)
        .capturePage(undefined, { stayHidden: true });
      if (image.isEmpty()) throw new Error("Empty native capture");
      return image.toPNG().toString("base64");
    }, id);
    const file = path.join(output, `${name}.png`);
    await fs.writeFile(file, Buffer.from(png, "base64"));
    evidence.screenshots.push(file);
  };
  const picker = () =>
    native.page.evaluate(() => {
      const node = document.elementFromPoint(2, 2);
      return (
        node?.parentElement === document.documentElement &&
        ["crosshair", "text"].includes(node.style.cursor)
      );
    });
  const enterDevice = async () => {
    await click(page.getByTestId("browser-workspace-options"));
    await wait(
      () =>
        app.evaluate(async ({ webContents }) => {
          for (const wc of webContents.getAllWebContents()) {
            if (!wc.getURL().startsWith("data:text/html")) continue;
            if (
              await wc.executeJavaScript(
                `(() => { const node = document.querySelector('[role="menu"] [data-id="device"]'); if (!node || !window.browserMenu) return false; node.click(); return true; })()`,
              )
            )
              return true;
          }
          return false;
        }),
      Boolean,
      "Native device menu missing",
    );
    await toolbar.waitFor({ state: "visible" });
  };
  const dispatch = (points, drag) =>
    app.evaluate(
      ({ webContents }, { id, points, drag }) => {
        const wc = webContents.fromId(id);
        wc.focus();
        const send = (type, point) =>
          wc.sendInputEvent({
            type,
            ...point,
            button: "left",
            clickCount: 1,
            ...(type === "mouseMove" && drag
              ? { modifiers: ["leftButtonDown"] }
              : {}),
          });
        send("mouseMove", points[0]);
        send("mouseDown", points[0]);
        if (drag)
          for (let index = 1; index <= 8; index++)
            send("mouseMove", {
              x: Math.round(
                points[0].x + ((points[1].x - points[0].x) * index) / 8,
              ),
              y: Math.round(
                points[0].y + ((points[1].y - points[0].y) * index) / 8,
              ),
            });
        send("mouseUp", points.at(-1));
        return { webContentsId: wc.id, focused: wc.isFocused(), points };
      },
      { id: guiBeforeTurn.webContentsId, points, drag },
    );
  await fs.mkdir(output, { recursive: true });
  await observeBrowserAnnotationInputs(app, key, { retainScreenshots: true });
  try {
    evidence.stage = "native-page";
    evidence.workspace = await ctx.readBrowserWorkspaceState(page);
    native = await waitForBrowserAnnotationNativePage(
      app,
      { ...options, timeoutMs: 20000 },
      (url) => url === evidence.workspace.address,
      "Native Browser missing",
    );
    observe(page);
    observe(native.page);
    assert(
      native.native.webContentsId === guiBeforeTurn.webContentsId,
      "Canonical native identity mismatch",
    );
    // Fixture DOM only; product selection is produced by the real private page preload.
    await native.page.evaluate(() => {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width,initial-scale=1";
      document.head.append(meta);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        "#device-annotation-target { position:fixed; left:80px; top:100px; width:120px; height:72px; padding:0; border:0; background:rgb(12,180,92) } ",
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const target = document.createElement("div");
      target.id = "device-annotation-target";
      target.setAttribute("aria-label", "Device annotation target");
      document.body.append(target);
      globalThis.__deviceAnnotationClicks = 0;
      target.addEventListener(
        "click",
        () => globalThis.__deviceAnnotationClicks++,
      );
    });
    evidence.stage = "screenshot-settings";
    console.log("[browser-device-annotation] stage=screenshot-settings");
    await click(page.getByTestId("app-sidebar-nav-settings"));
    await page.getByTestId("settings-navigation").waitFor({ state: "visible" });
    await click(page.getByTestId("settings-sidebar-tab-browser-use"));
    const preference = page.locator("#browser-annotation-screenshot button");
    await preference.click();
    await click(
      page.getByRole("menuitemradio", {
        name: label("settings", "browser.screenshot.necessary"),
        exact: true,
      }),
    );
    await wait(
      async () => ({
        label: await preference.innerText(),
        disabled: await preference.isDisabled(),
      }),
      (value) =>
        !value.disabled &&
        value.label === label("settings", "browser.screenshot.necessary"),
      "Screenshot setting did not persist",
    );
    await click(page.getByTestId("settings-back-button"));
    await page
      .getByTestId("browser-annotation-select")
      .waitFor({ state: "visible" });
    evidence.initial = await measure();
    const cases = [
      { name: "desktop", zoom: 1 },
      { name: "responsive-fit", preset: "responsive", zoom: 1 },
      { name: "responsive-page-zoom", preset: "responsive", zoom: 1.5 },
      { name: "phone-portrait", preset: "iphone-15-pro-max", zoom: 1 },
      { name: "phone-landscape-zoom", rotate: true, zoom: 1.5 },
    ];
    for (const scenario of cases) {
      console.log(`[browser-device-annotation] case=${scenario.name}`);
      evidence.stage = scenario.name;
      if (scenario.preset && !(await toolbar.count())) await enterDevice();
      if (scenario.preset) {
        await preset.selectOption(scenario.preset);
        if (scenario.preset === "responsive") {
          await toolbar.getByTestId("browser-device-width").fill("900");
          await toolbar.getByTestId("browser-device-height").fill("1600");
          await toolbar.getByTestId("browser-device-height").press("Tab");
        }
      }
      if (scenario.rotate) await click(button("rotate"));
      if (scenario.preset || scenario.rotate)
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="browser-device-toolbar"]')
              ?.getAttribute("aria-busy") !== "true",
        );
      await page.evaluate(
        async ({ tabId, zoomFactor }) =>
          window.electronAPI.invoke("browser_tab_set_zoom", {
            tabId,
            zoomFactor,
          }),
        { tabId: guiBeforeTurn.tabId, zoomFactor: scenario.zoom },
      );
      await settledMeasure(scenario.zoom);
      for (const kind of ["element", "region"]) {
        const cell = {
          name: `${scenario.name}-${kind}`,
          kind,
          before: await measure(),
        };
        evidence.cells.push(cell);
        cell.baselineSample = await app.evaluate(
          async ({ webContents }, { id, viewport }) => {
            const image = await webContents
              .fromId(id)
              .capturePage(undefined, { stayHidden: true });
            const size = image.getSize();
            return [
              ...image
                .crop({
                  x: Math.floor((170 / viewport.innerWidth) * size.width),
                  y: Math.floor((150 / viewport.innerHeight) * size.height),
                  width: 1,
                  height: 1,
                })
                .toBitmap(),
            ];
          },
          { id: guiBeforeTurn.webContentsId, viewport: cell.before.metrics },
        );
        const select = page.getByTestId("browser-annotation-select");
        if ((await select.getAttribute("aria-pressed")) !== "true")
          await click(select);
        await wait(picker, Boolean, "Native picker missing");
        // Annotation toolbar changes the available height; measure after it is mounted.
        cell.initialAfterPicker = await measure();
        cell.before = await settledMeasure(scenario.zoom);
        const css =
          kind === "element"
            ? [{ x: 170, y: 150 }]
            : [
                { x: 60, y: 80 },
                { x: 240, y: 200 },
              ];
        const { bounds } = cell.before.native;
        cell.input = css.map((point) => ({
          x: Math.round(
            (point.x * bounds.width) / cell.before.metrics.innerWidth,
          ),
          y: Math.round(
            (point.y * bounds.height) / cell.before.metrics.innerHeight,
          ),
        }));
        cell.expectedRect =
          kind === "element"
            ? cell.before.metrics.rect
            : { x: 60, y: 80, width: 180, height: 120 };
        cell.tolerance = Math.max(
          2,
          (3 * cell.before.metrics.innerWidth) / bounds.width,
        );
        const commandCount = (await readBrowserAnnotationCommands(app, key))
          .length;
        cell.dispatched = await dispatch(cell.input, kind === "region");
        cell.capture = await wait(
          async () =>
            (await readBrowserAnnotationCommands(app, key))
              .slice(commandCount)
              .find(
                (record) =>
                  record.command === "browser_tab_capture_annotation" &&
                  record.status !== "pending",
              ),
          Boolean,
          "Native selection/capture missing",
        );
        cell.selection = cell.capture.selection;
        const editor = await waitForBrowserAnnotationNativePage(
          app,
          options,
          (url) => /\/browser-annotation\.html(?:[?#]|$)/u.test(url),
          "Trusted editor missing",
        );
        editor.page.setDefaultTimeout(Math.min(20000, options.timeoutMs));
        observe(editor.page);
        await editor.page.getByRole("dialog").waitFor({ state: "visible" });
        await editor.page.getByTestId("browser-annotation-composer").waitFor();
        cell.editor = {
          native: await readBrowserAnnotationNativeIdentity(
            app,
            editor.native.webContentsId,
          ),
          bridge: await editor.page.evaluate(() => ({
            narrow:
              Object.keys(window.browserAnnotationEditor ?? {})
                .sort()
                .join(",") === "act,onUpdate,ready,resize",
            keys: Object.keys(window.browserAnnotationEditor ?? {}).sort(),
            general: typeof window.electronAPI?.invoke === "function",
            node:
              typeof window.require === "function" ||
              typeof window.process === "object",
          })),
          window: await app.evaluate(
            ({ BrowserWindow }, id) =>
              BrowserWindow.fromId(id).getContentBounds(),
            editor.native.windowId,
          ),
        };
        const image = await app.evaluate(
          async ({ nativeImage, webContents }, { key, id }) => {
            const captured = globalThis[key].screenshots.at(-1);
            if (!captured) return null;
            const decoded = nativeImage.createFromDataURL(captured.dataUrl);
            const size = decoded.getSize();
            const raw = await webContents
              .fromId(id)
              .capturePage(undefined, { stayHidden: true });
            const rect = captured.cropRect ?? {
              x: 0,
              y: 0,
              ...captured.viewportSize,
            };
            const samplePoint = {
              x: Math.floor(((170 - rect.x) / rect.width) * size.width),
              y: Math.floor(((150 - rect.y) / rect.height) * size.height),
            };
            const sample = [
              ...decoded
                .crop({ ...samplePoint, width: 1, height: 1 })
                .toBitmap(),
            ];
            return {
              dataUrl: captured.dataUrl,
              size,
              rawSize: raw.getSize(),
              sample,
              samplePoint,
              cropRect: captured.cropRect,
            };
          },
          { key, id: guiBeforeTurn.webContentsId },
        );
        assert(image, "No actual product capture output retained");
        const file = path.join(output, `${cell.name}-capture.png`);
        await fs.writeFile(
          file,
          Buffer.from(image.dataUrl.split(",")[1], "base64"),
        );
        const { dataUrl: _data, ...imageSummary } = image;
        cell.image = { ...imageSummary, file };
        cell.clicksAfter = (await metrics()).clicks;
        cell.assertions = browserDeviceAnnotationAssertions(cell);
        for (const [name, passed] of Object.entries(cell.assertions))
          evidence.assertions[`${cell.name}.${name}`] = passed;
        await screenshot(editor.native.webContentsId, `${cell.name}-editor`);
        await screenshot(guiBeforeTurn.webContentsId, `${cell.name}-page`);
        await click(
          editor.page.getByRole("button", {
            name: label("browserAnnotation", "close"),
            exact: true,
          }),
        );
        await wait(
          async () =>
            readBrowserAnnotationNativeIdentity(
              app,
              editor.native.webContentsId,
            ),
          (value) => !value || !value.visible,
          "Close did not close native editor",
        );
        const discardAll = page
          .getByTestId("browser-annotation-toolbar")
          .getByRole("button", {
            name: label("browserAnnotation", "discardAll"),
            exact: true,
          });
        await click(discardAll);
        await wait(
          () =>
            app.evaluate(async ({ webContents }) => {
              for (const wc of webContents.getAllWebContents()) {
                if (!wc.getURL().startsWith("data:text/html")) continue;
                if (
                  await wc.executeJavaScript(
                    `(() => { const node = document.querySelector('[data-id="discard"]'); if (!node || !window.browserMenu) return false; node.click(); return true; })()`,
                  )
                )
                  return true;
              }
              return false;
            }),
          Boolean,
          "Native discard confirmation missing",
        );
        await wait(
          () => discardAll.isDisabled(),
          Boolean,
          "Drafts did not clear after confirmation",
        );
        cell.cleanedThroughUi = true;
        await click(
          page.getByTestId("browser-annotation-toolbar").getByRole("button", {
            name: label("browserAnnotation", "exit"),
            exact: true,
          }),
        );
        await wait(picker, (value) => !value, "Picker did not exit");
      }
    }
    const trace = await ctx.readInvokeTrace();
    const final = await ctx.readBrowserWorkspaceState(page);
    evidence.assertions.sameNativeTab =
      final.tabId === guiBeforeTurn.tabId &&
      final.webContentsId === guiBeforeTurn.webContentsId &&
      final.threadId === guiBeforeTurn.threadId;
    evidence.assertions.productionBridge = trace.some(
      (entry) =>
        entry.command === "app_server_handle_json_lines" &&
        entry.transport === "electron-ipc",
    );
    evidence.assertions.noMockFallback = !trace.some(
      (entry) => entry.transport === "mock" || entry.fallback === true,
    );
    evidence.diagnostics.hiddenHost = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence ?? null,
    );
    evidence.assertions.hiddenRealHost =
      evidence.diagnostics.hiddenHost?.visibilityOnly === true &&
      evidence.diagnostics.hiddenHost.unexpectedShowEvents === 0 &&
      evidence.diagnostics.hiddenHost.preloadErrors.length === 0;
    evidence.assertions.noPageErrors =
      !evidence.diagnostics.consoleErrors.length &&
      !evidence.diagnostics.pageErrors.length;
    evidence.failedAssertions = Object.keys(evidence.assertions).filter(
      (name) => !evidence.assertions[name],
    );
    evidence.status = evidence.failedAssertions.length ? "fail" : "pass";
    return evidence;
  } catch (error) {
    evidence.error = sanitizeText(error);
    evidence.commands = await readBrowserAnnotationCommands(app, key);
    evidence.last = await measure().catch(() => null);
    await fs.writeFile(
      options.output,
      JSON.stringify(evidence, null, 2) + "\n",
    );
    throw error;
  } finally {
    await app
      .evaluate((_electron, key) => globalThis[key]?.close(), key)
      .catch(() => {});
  }
}
