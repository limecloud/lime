import fs from "node:fs/promises";
import path from "node:path";
import {
  assert,
  sleep,
  sanitizeText,
} from "./claw-chat-current-fixture-utils.mjs";

/** Real toolbar -> existing IPC -> the same native WebContents, without an Agent turn. */
export async function runBrowserDeviceScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const flows = [];
  const resizeTrace = {};
  // Independent expectations from the pinned Codex shared member, not the product catalog.
  const catalog = [
    ["responsive", 390, 844],
    ["4k", 2560, 1440],
    ["laptop-l", 1440, 900],
    ["laptop", 1024, 768],
    ["surface-pro-7", 912, 1368],
    ["ipad-air", 820, 1180],
    ["ipad-mini", 768, 1024],
    ["surface-duo", 540, 720],
    ["iphone-15-pro-max", 430, 932],
    ["pixel-8", 412, 915],
    ["iphone-15-pro", 393, 852],
    ["samsung-galaxy-s24-ultra", 384, 824],
    ["iphone-se", 375, 667],
  ];
  const labels = JSON.parse(
    await fs.readFile(
      path.resolve(`src/i18n/resources/${options.locale}/browserChrome.json`),
      "utf8",
    ),
  );
  const toolbar = page.getByTestId("browser-device-toolbar");
  const button = (key) =>
    toolbar.getByRole("button", {
      name: labels[`browserChrome.${key}`],
      exact: true,
    });
  const preset = toolbar.getByRole("combobox", {
    name: labels["browserChrome.device"],
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
  const native = () =>
    app.evaluate(async ({ webContents, BrowserWindow }, id) => {
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) return null;
      const view = BrowserWindow.getAllWindows()
        .flatMap((window) => window.contentView.children)
        .find((view) => view.webContents?.id === id);
      return {
        id: wc.id,
        zoom: wc.getZoomFactor(),
        bounds: view?.getBounds(),
        metrics:
          await wc.executeJavaScript(`({ width: screen.width, height: screen.height,
        dpr: devicePixelRatio, innerWidth, innerHeight, node: typeof require,
        bridge: typeof window.electronAPI })`),
      };
    }, guiBeforeTurn.webContentsId);
  const waitFor = async (read, predicate, label) => {
    const until = Date.now() + Math.min(20000, options.timeoutMs);
    let last;
    do {
      last = await read();
      if (predicate(last)) return last;
      await sleep(100);
    } while (Date.now() < until);
    throw new Error(`${label}: ${JSON.stringify(last)}`);
  };
  const settled = async (predicate, label) => {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="browser-device-toolbar"]')
          ?.getAttribute("aria-busy") !== "true",
    );
    return waitFor(readState, predicate, label);
  };
  const capture = async (name, predicate) => {
    const read = async () => ({
      state: await readState(),
      native: await native(),
      bounds: await page
        .getByTestId("browser-workspace-viewport")
        .boundingBox(),
      renderer: await page
        .getByTestId("browser-device-viewport")
        .evaluate((frame) => {
          const bounds = (element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          };
          return {
            frame: bounds(frame),
            handles: Array.from(frame.querySelectorAll("button"), (button) => ({
              edge: button.getAttribute("data-testid"),
              ...bounds(button),
            })),
          };
        }),
    });
    const sample = predicate
      ? await waitFor(read, predicate, `coherent ${name}`)
      : await read();
    flows.push({
      name,
      state: sample.state,
      native: sample.native,
      viewport: sample.bounds,
      renderer: sample.renderer,
    });
    return sample;
  };
  const fitted = ({ state, bounds }) =>
    Boolean(
      bounds &&
      state.device &&
      state.deviceViewport &&
      state.deviceViewport.bounds.width <= bounds.width - 39 &&
      state.deviceViewport.bounds.height <= bounds.height - 19 &&
      state.deviceViewport.scale <= state.device.scale,
    );
  try {
    const before = await native();
    await page.evaluate(async (tabId) => {
      await window.electronAPI.invoke("browser_tab_set_zoom", {
        tabId,
        zoomFactor: 1.5,
      });
    }, guiBeforeTurn.tabId);
    await waitFor(native, (value) => value?.zoom === 1.5, "initial page zoom");
    await page.getByTestId("browser-workspace-options").click();
    await waitFor(
      () =>
        app.evaluate(async ({ webContents }) => {
          for (const wc of webContents.getAllWebContents()) {
            if (!wc.getURL().startsWith("data:text/html")) continue;
            const clicked = await wc.executeJavaScript(`(() => {
          const button = document.querySelector('[role="menu"] [data-id="device"]');
          if (!button || !window.browserMenu) return false;
          button.click(); return true;
        })()`);
            if (clicked) return true;
          }
          return false;
        }),
      Boolean,
      "native device menu",
    );
    await toolbar.waitFor({ state: "visible" });
    assertions.nativeMenuOpensToolbar = true;
    assertions.initialResponsiveIdentity =
      (await preset.inputValue()) === "responsive";
    assertions.completeOrderedCatalog =
      JSON.stringify(
        await preset
          .locator("option")
          .evaluateAll((items) => items.map((item) => item.value)),
      ) === JSON.stringify(catalog.map(([id]) => id));

    await settled((state) => Boolean(state?.device), "initial fit");
    const firstFit = await capture("responsive-fit");
    assertions.initialDeviceFitsBothAxes = fitted(firstFit);

    const splitter = page.getByTestId("layout-chat-canvas-resize-handle");
    await splitter.press("End");
    const zoomSelect = toolbar.getByRole("combobox", {
      name: labels["browserChrome.zoom"],
      exact: true,
    });
    await zoomSelect.waitFor({ state: "visible" });
    const zoomBefore = await readState();
    const expectedZoom = Math.min(
      5,
      Math.max(0.25, Math.round(100 / zoomBefore.deviceViewport.scale) / 100),
    );
    await zoomSelect.selectOption("100");
    await settled(
      (state) => state?.zoomFactor === expectedZoom,
      "display zoom lowers to native zoom",
    );
    await waitFor(
      native,
      (value) => Math.abs(value?.zoom - expectedZoom) < 0.000001,
      "native toolbar page zoom",
    );
    assertions.renderedZoomMapsToNative =
      Number(await zoomSelect.inputValue()) ===
      Math.round(expectedZoom * 100 * (await readState()).deviceViewport.scale);
    assertions.zoomDoesNotChangeDevice =
      JSON.stringify((await readState()).device) ===
      JSON.stringify(zoomBefore.device);

    for (const [id, width, height] of catalog) {
      await preset.selectOption(id);
      await settled(
        (state) =>
          state?.device?.presetId === id &&
          state.device.width === width &&
          state.device.height === height &&
          state.zoomFactor === 1,
        `preset ${id}`,
      );
      await waitFor(
        native,
        (value) =>
          value?.metrics.width === width &&
          value.metrics.height === height &&
          value.zoom === 1,
        `native ${id}`,
      );
      const flow = await capture(`catalog-${id}`);
      assertions[`catalog:${id}`] =
        fitted(flow) &&
        flow.state.device.presetId === id &&
        (await preset.inputValue()) === id &&
        flow.native.id === before.id &&
        flow.state.tabId === guiBeforeTurn.tabId &&
        flow.state.threadId === guiBeforeTurn.threadId &&
        flow.state.device.deviceScaleFactor ===
          firstFit.state.device.deviceScaleFactor &&
        flow.native.metrics.dpr === firstFit.native.metrics.dpr &&
        flow.native.zoom === 1;
      if (id === "4k") {
        const deviceBeforeZoom = (await readState()).device;
        const base = Math.min(
          5,
          Math.max(
            0.25,
            Math.round(200 / flow.state.deviceViewport.scale) / 100,
          ),
        );
        await zoomSelect.selectOption("200");
        await settled(
          (state) => state?.zoomFactor === base,
          "fitted zoom native clamp",
        );
        await waitFor(
          native,
          (value) => Math.abs(value?.zoom - base) < 0.000001,
          "clamped native page zoom",
        );
        assertions.zoomUsesNativeClamp =
          base === 5 && (await readState()).zoomFactor === 5;
        assertions.zoomKeepsNativeDevice =
          JSON.stringify((await readState()).device) ===
          JSON.stringify(deviceBeforeZoom);
        await preset.selectOption("4k");
        await settled(
          (state) => state?.zoomFactor === 1,
          "preset resets zoom after fitted zoom",
        );
      }
    }

    await preset.selectOption("ipad-air");
    await settled(
      (state) => state?.device?.width === 820 && state.device.height === 1180,
      "iPad Air preset",
    );
    await waitFor(
      native,
      (value) => value?.metrics.width === 820 && value.metrics.height === 1180,
      "native iPad Air screen",
    );
    const tablet = await capture("ipad-air-fit");
    assertions.tabletFitsBothAxes = fitted(tablet);
    assertions.tabletPresetVisible = (await preset.inputValue()) === "ipad-air";
    assertions.nativeDprPreserved =
      firstFit.state.device.deviceScaleFactor === 3 &&
      firstFit.native.metrics.dpr === 3 &&
      tablet.state.device.deviceScaleFactor === 3 &&
      tablet.native.metrics.dpr === 3;

    await page.evaluate(async (tabId) => {
      await window.electronAPI.invoke("browser_tab_set_zoom", {
        tabId,
        zoomFactor: 1.5,
      });
    }, guiBeforeTurn.tabId);
    await waitFor(native, (value) => value?.zoom === 1.5, "zoom before rotate");
    await button("rotate").click();
    await settled(
      (state) => state?.device?.width === 1180 && state.device.height === 820,
      "rotate viewport",
    );
    await waitFor(
      native,
      (value) => value?.metrics.width === 1180 && value.metrics.height === 820,
      "native rotated screen",
    );
    const rotated = await capture("ipad-air-rotated-fit");
    assertions.rotatedFitsBothAxes = fitted(rotated);
    assertions.rotationPreservesPageZoom =
      rotated.native.zoom === 1.5 && rotated.state.zoomFactor === 1.5;
    assertions.rotationRetainsPreset =
      (await preset.inputValue()) === "ipad-air";

    const toggle = page.getByTestId("thread-side-panel-toggle");
    resizeTrace.minimumPaneHeader = await toggle.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return {
        reachable: hit === button || button.contains(hit),
        windowAction:
          button.closest('[data-header-action-id="thread-side-panel-close"]') !=
          null,
        tools: Array.from(
          document.querySelectorAll(
            '[data-testid="thread-workspace-header-tools"]',
          ),
          (tools) => {
            const bounds = tools.getBoundingClientRect();
            const header = tools.closest(
              '[data-testid="thread-workspace-header"]',
            );
            const headerBounds = header?.getBoundingClientRect();
            return {
              width: bounds.width,
              scrollWidth: tools.scrollWidth,
              contained:
                headerBounds != null &&
                bounds.left >= headerBounds.left - 1 &&
                bounds.right <= headerBounds.right + 1,
            };
          },
        ),
        interceptedBy: hit
          ?.closest("[data-testid]")
          ?.getAttribute("data-testid"),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    });
    await page.screenshot({
      path: path.join(path.dirname(options.output), "minimum-pane-header.png"),
    });
    assertions.minimumPaneHeaderReachable =
      resizeTrace.minimumPaneHeader.reachable;
    assertions.sidePanelToggleUsesWindowAction =
      resizeTrace.minimumPaneHeader.windowAction;
    assertions.minimumPaneToolsStayInsideHeader =
      resizeTrace.minimumPaneHeader.tools.length === 1 &&
      resizeTrace.minimumPaneHeader.tools.every((tools) => tools.contained);
    assert(
      assertions.minimumPaneHeaderReachable &&
        assertions.sidePanelToggleUsesWindowAction &&
        assertions.minimumPaneToolsStayInsideHeader,
      `Minimum pane header: ${JSON.stringify(resizeTrace.minimumPaneHeader)}`,
    );
    await toggle.click({ timeout: 20000 });
    await toolbar.waitFor({ state: "hidden" });
    assertions.minimumPaneToggleCloses = true;
    await toggle.click({ timeout: 20000 });
    await toolbar.waitFor({ state: "visible" });
    assertions.minimumPaneToggleRestores = true;
    await settled(
      (state) => state?.device?.presetId === "ipad-air",
      "remounted device identity",
    );
    const remounted = await capture("ipad-air-remounted");
    assertions.remountPreservesPresetAndNative =
      (await preset.inputValue()) === "ipad-air" &&
      JSON.stringify(remounted.state.device) ===
        JSON.stringify(rotated.state.device) &&
      remounted.native.id === rotated.native.id &&
      remounted.state.url === rotated.state.url;

    await preset.selectOption("responsive");
    await settled(
      (state) =>
        state?.device?.presetId === "responsive" && state.zoomFactor === 1,
      "responsive mode",
    );
    assertions.responsiveSelectable =
      (await preset.inputValue()) === "responsive";
    const responsive = await capture("responsive-retains-rotated-dimensions");
    assertions.responsivePreservesDevice =
      JSON.stringify(responsive.state.device) ===
      JSON.stringify({ ...rotated.state.device, presetId: "responsive" });

    // A responsive viewport can have exactly the dimensions of a named preset.
    await toolbar.getByTestId("browser-device-width").fill("820");
    await toolbar.getByTestId("browser-device-height").fill("1180");
    await settled(
      (state) => state?.device?.width === 820 && state.device.height === 1180,
      "same-size responsive",
    );
    assertions.sameSizeResponsiveIsNotInferred =
      (await preset.inputValue()) === "responsive" &&
      (await readState()).device.presetId === "responsive";
    const width = toolbar.getByTestId("browser-device-width");
    await width.fill("99");
    const invalid = await readState();
    assertions.invalidDraftDoesNotReachNative =
      invalid.device.width === 820 && (await width.inputValue()) === "99";
    await width.press("Enter");
    await settled(
      (state) => state?.device?.width === 240,
      "width clamps on Enter blur",
    );
    assertions.blurClampsInvalidDimension =
      (await width.inputValue()) === "240" &&
      (await readState()).device.width === 240;
    await width.fill("");
    await width.press("Tab");
    assertions.emptyInputRestoresNative = (await width.inputValue()) === "240";
    await width.fill("900");
    await toolbar.getByTestId("browser-device-height").fill("1600");
    await settled(
      (state) => state?.device?.width === 900 && state.device.height === 1600,
      "custom viewport fit",
    );
    // Host receipts and the renderer projection can arrive on different frames.
    const custom = await capture("responsive-custom-fit", (sample) => {
      const actual = sample.native?.bounds;
      return (
        actual &&
        sample.bounds &&
        ["x", "y", "width", "height"].every(
          (key) => Math.abs(actual[key] - sample.renderer.frame[key]) <= 0.01,
        ) &&
        Math.abs(
          actual.x -
            (Math.round(sample.bounds.x) +
              Math.round((Math.round(sample.bounds.width) - actual.width) / 2)),
        ) <= 1
      );
    });
    assertions.customFitsBothAxes = fitted(custom);
    assertions.nativeBoundsMatchProjection =
      JSON.stringify(custom.native.bounds) ===
      JSON.stringify(custom.state.deviceViewport.bounds);
    assertions.requestedScaleRemainsCeiling =
      custom.state.device.scale === 1 && custom.state.deviceViewport.scale <= 1;
    const handles = custom.renderer.handles;
    const actual = custom.native.bounds;
    assertions.fiveHandlesOutsideNativePage =
      handles.length === 5 &&
      handles.every(
        (handle) =>
          Math.min(handle.x + handle.width, actual.x + actual.width) <=
            Math.max(handle.x, actual.x) + 0.01 ||
          Math.min(handle.y + handle.height, actual.y + actual.height) <=
            Math.max(handle.y, actual.y) + 0.01,
      );
    const right = await page
      .getByTestId("browser-device-resize-right")
      .boundingBox();
    assert(right, "responsive right handle missing");
    await page.mouse.move(
      right.x + right.width / 2,
      right.y + right.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      right.x + right.width / 2 + 20,
      right.y + right.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await settled(
      (state) =>
        state?.device?.width ===
        Math.round(900 + 40 / custom.state.deviceViewport.scale),
      "native responsive drag",
    );
    const dragged = await capture("responsive-dragged");
    assertions.dragResizesNativeViewport =
      dragged.state.device.width ===
        Math.round(900 + 40 / custom.state.deviceViewport.scale) &&
      fitted(dragged);
    const selectResult = await page.evaluate(
      async (tabId) =>
        window.electronAPI.invoke("browser_tab_select", { tabId }),
      guiBeforeTurn.tabId,
    );
    assertions.selectionDoesNotShrinkContainer =
      JSON.stringify(selectResult.deviceViewport) ===
      JSON.stringify(dragged.state.deviceViewport);
    const beforeResizeTrace = await waitFor(
      readInvokeTrace,
      (entries) =>
        entries.some(
          (entry) =>
            entry.command === "browser_tab_set_device" &&
            entry.status === "success" &&
            entry.args_preview?.device?.width === dragged.state.device.width,
        ),
      "drag receipt collected before passive resize",
    );
    const deviceCommands = (entries) =>
      entries.filter((entry) => entry.command === "browser_tab_set_device")
        .length;
    await app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === id,
      );
      if (!window) throw new Error("renderer window missing");
      const bounds = window.getBounds();
      window.setBounds({
        ...bounds,
        width: bounds.width + 160,
        height: Math.max(760, bounds.height - 120),
      });
    }, custom.state.ownerWebContentsId);
    await waitFor(
      readState,
      (state) =>
        state?.deviceViewport?.scale < dragged.state.deviceViewport.scale,
      "passive native device fit",
    );
    const resized = await capture("responsive-container-resized", (sample) => {
      const bounds = sample.native?.bounds;
      return (
        fitted(sample) &&
        bounds &&
        JSON.stringify(bounds) ===
          JSON.stringify(sample.state.deviceViewport.bounds) &&
        Math.abs(
          bounds.x -
            (Math.round(sample.bounds.x) +
              Math.round((Math.round(sample.bounds.width) - bounds.width) / 2)),
        ) <= 1 &&
        Math.abs(bounds.y - Math.round(sample.bounds.y)) <= 1
      );
    });
    assertions.passiveResizeFitsNative =
      fitted(resized) &&
      JSON.stringify(resized.native.bounds) ===
        JSON.stringify(resized.state.deviceViewport.bounds);
    const afterResizeTrace = await waitFor(
      readInvokeTrace,
      (entries) =>
        entries.some(
          (entry) =>
            entry.command === "browser_tab_set_bounds" &&
            entry.status === "success" &&
            Math.abs(
              entry.args_preview?.bounds?.height - resized.bounds.height,
            ) <= 1,
        ),
      "passive bounds receipt collected",
    );
    resizeTrace.deviceCommandsBefore = beforeResizeTrace.filter(
      (entry) => entry.command === "browser_tab_set_device",
    );
    resizeTrace.deviceCommandsAfter = afterResizeTrace.filter(
      (entry) => entry.command === "browser_tab_set_device",
    );
    assertions.passiveResizeDoesNotSetDevice =
      deviceCommands(afterResizeTrace) === deviceCommands(beforeResizeTrace);
    assertions.presetResetsPageZoom = flows
      .filter((flow) => flow.name.startsWith("catalog-"))
      .every((flow) => flow.native.zoom === 1 && flow.state.zoomFactor === 1);
    assertions.dimensionAndPassiveResizePreservePageZoom =
      custom.native.zoom === 1 && resized.native.zoom === 1;
    assertions.referenceToolbarControls =
      (await toolbar.locator("input").count()) === 2 &&
      (await toolbar.locator("button").count()) === 2 &&
      !(await toolbar.locator("form").count());
    const screenshotPath = path.join(
      path.dirname(options.output),
      `${options.locale}-device-toolbar.png`,
    );
    await page.screenshot({ path: screenshotPath });
    const nativeScreenshotPath = path.join(
      path.dirname(options.output),
      `${options.locale}-device-page.png`,
    );
    const nativePng = await app.evaluate(async ({ webContents }, id) => {
      const image = await webContents.fromId(id).capturePage();
      if (image.isEmpty()) throw new Error("Native device screenshot is empty");
      return image.toPNG().toString("base64");
    }, guiBeforeTurn.webContentsId);
    await fs.writeFile(nativeScreenshotPath, Buffer.from(nativePng, "base64"));
    await button("closeDevice").click();
    await toolbar.waitFor({ state: "detached" });
    await waitFor(
      readState,
      (state) => state?.device === null,
      "device disabled",
    );
    const readRestored = async () => ({
      native: await native(),
      viewport: await page
        .getByTestId("browser-workspace-viewport")
        .boundingBox(),
    });
    resizeTrace.restorationFirstSample = await readRestored();
    const restored = await waitFor(
      readRestored,
      ({ native: value, viewport }) =>
        value?.metrics.width === before.metrics.width &&
        value.metrics.height === before.metrics.height &&
        viewport &&
        ["x", "y", "width", "height"].every(
          (key) => Math.abs(value.bounds[key] - viewport[key]) <= 1,
        ),
      "native screen and renderer container restored",
    );
    resizeTrace.restoration = restored;
    const after = restored.native;
    const finalViewport = restored.viewport;
    assertions.nativeScreenRestored = Boolean(after);
    assertions.fullContainerRestored =
      finalViewport &&
      ["x", "y", "width", "height"].every(
        (key) => Math.abs(after.bounds[key] - finalViewport[key]) <= 1,
      );
    assertions.pageRemainsSandboxed =
      after.metrics.node === "undefined" &&
      after.metrics.bridge === "undefined";
    const gui = await readBrowserWorkspaceState(page);
    assertions.sameNativeTab =
      gui.webContentsId === before.id &&
      gui.tabId === guiBeforeTurn.tabId &&
      gui.threadId === guiBeforeTurn.threadId &&
      flows.every(({ state }) =>
        [
          "sessionId",
          "threadId",
          "tabId",
          "viewId",
          "webContentsId",
          "ownerWebContentsId",
          "windowId",
        ].every((key) => state[key] === firstFit.state[key]),
      );
    const trace = await waitFor(
      readInvokeTrace,
      (entries) =>
        entries.filter(
          (entry) =>
            entry.command === "browser_tab_set_device" &&
            entry.transport === "electron-ipc",
        ).length >= 7,
      "device IPC trace",
    );
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
      scenario: "device",
      input:
        "Playwright DOM and CDP mouse input in real Electron; native menu DOM click; no Agent turn or physical OS pointer input",
      claimBoundary:
        "Existing App Server thread/surface owner and native device UI; no runtime tool or Agent turn exercised",
      assertions,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      flows,
      screenshotPath,
      nativeScreenshotPath,
      screenshotBoundary:
        "Renderer and native WCV captured separately; not an OS-composited window",
      diagnostics: { hiddenHost, resizeTrace },
    };
  } catch (error) {
    await fs.writeFile(
      options.output,
      JSON.stringify(
        {
          scenario: "device",
          status: "fail",
          assertions,
          flows,
          diagnostics: { resizeTrace },
          error: sanitizeText(error),
          state: await readState().catch(() => null),
          native: await native().catch(() => null),
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  }
}
