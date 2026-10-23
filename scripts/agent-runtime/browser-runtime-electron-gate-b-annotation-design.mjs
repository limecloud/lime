import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appServerCallFromPage } from "../electron/mcp-config-fixture-smoke.mjs";
import { assert } from "./claw-chat-current-fixture-utils.mjs";
import {
  observeBrowserAnnotationInputs,
  readBrowserAnnotationCommands,
  readBrowserAnnotationNativeIdentity,
  waitForBrowserAnnotationNativePage,
  waitForBrowserAnnotationState as waitFor,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { summarizeBrowserDesignSubmission } from "./browser-design-submit-evidence.mjs";

/** Synthetic DOM input only; never inject selections, drafts, receipts or accepted turns. */
export async function runBrowserAnnotationDesignScenario(ctx) {
  const { app, page, options, identity, providerFixture } = ctx;
  const output = path.dirname(options.output);
  const key = `__browserDesign_${randomUUID().replaceAll("-", "")}`;
  const labels = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${options.locale}/browserAnnotation.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (name) => labels[`browserAnnotation.${name}`];
  const evidence = {
    scenario: "annotation-design",
    result: "fail",
    hiddenWindow: true,
    physicalInput: false,
    pid: app.process().pid,
    bridgeReplacement: false,
    screenshots: [],
    diagnostics: { consoleErrors: [], pageErrors: [] },
  };
  const click = (locator) => locator.evaluate((node) => node.click());
  const stage = (name) => {
    evidence.stage = name;
    console.log(`[browser-design-submit] stage=${name}`);
  };
  const observe = (target) => {
    target.on("pageerror", (error) =>
      evidence.diagnostics.pageErrors.push(String(error)),
    );
    target.on("console", (message) => {
      if (message.type() === "error")
        evidence.diagnostics.consoleErrors.push(message.text());
    });
  };
  const shot = async (target, name) => {
    try {
      const png = await app.evaluate(async ({ webContents }, id) => {
        const image = await webContents
          .fromId(id)
          .capturePage(undefined, { stayHidden: true });
        if (image.isEmpty()) throw new Error("Empty capture");
        return image.toPNG().toString("base64");
      }, target.native.webContentsId);
      const file = path.join(output, `${name}.png`);
      await fs.writeFile(file, Buffer.from(png, "base64"));
      evidence.screenshots.push({ name, file, status: "captured" });
    } catch (error) {
      evidence.screenshots.push({
        name,
        status: "unavailable",
        reason: String(error),
      });
    }
  };
  const geometry = async (editor) => ({
    native: await readBrowserAnnotationNativeIdentity(
      app,
      editor.native.webContentsId,
    ),
    dom: await editor.page.evaluate((save) => {
      const rect = (element) =>
        element?.getBoundingClientRect().toJSON() ?? null;
      const button = Array.from(document.querySelectorAll("button")).find(
        (node) => node.textContent === save,
      );
      return {
        innerHeight,
        innerWidth,
        visibility: document.visibilityState,
        card: rect(document.querySelector('[role="dialog"]')),
        design: rect(
          document.querySelector('[data-testid="browser-design-editor"]'),
        ),
        save: rect(button),
        saveDisabled: button?.disabled,
        body: document.querySelector(
          '[data-testid="browser-annotation-composer"]',
        )?.textContent,
      };
    }, label("save")),
  });
  await fs.mkdir(output, { recursive: true });
  await observeBrowserAnnotationInputs(app, key);
  try {
    observe(page);
    stage("native-page");
    const initial = await ctx.readBrowserWorkspaceState(page);
    evidence.initial = initial;
    const native = await waitForBrowserAnnotationNativePage(
      app,
      options,
      (url) => url === initial.address,
      "Canonical Browser page missing",
    );
    observe(native.page);
    assert(
      native.native.webContentsId === initial.webContentsId &&
        initial.threadId === identity.threadId,
      "Design page identity mismatch",
    );
    evidence.native = native.native;
    const baseline = await native.page.locator("h1").evaluate((element) => ({
      text: element.textContent,
      size: getComputedStyle(element).fontSize,
    }));
    evidence.baseline = baseline;
    const revisedText = `Design canonical ${randomUUID()}`;
    const revisedSize = "28px";
    assert(
      baseline.text && baseline.size !== revisedSize,
      "Invalid design baseline",
    );
    stage("select-element");
    const select = page.getByTestId("browser-annotation-select");
    if ((await select.getAttribute("aria-pressed")) !== "true")
      await click(select);
    await waitFor(
      options,
      () =>
        native.page.evaluate(() => {
          const node = document.elementFromPoint(2, 2);
          return (
            node?.parentElement === document.documentElement &&
            node.style.cursor === "crosshair"
          );
        }),
      Boolean,
      "Private picker did not start",
    );
    await native.page.locator("h1").evaluate((target) => {
      const rect = target.getBoundingClientRect();
      for (const type of ["pointermove", "pointerdown", "pointerup"])
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 1,
            clientX: rect.x + 10,
            clientY: rect.y + 10,
          }),
        );
    });
    const editor = await waitForBrowserAnnotationNativePage(
      app,
      options,
      (url) => /\/browser-annotation\.html(?:[?#]|$)/u.test(url),
      "Trusted editor missing",
    );
    observe(editor.page);
    await editor.page
      .getByTestId("browser-design-editor")
      .waitFor({ state: "attached" });
    assert(
      editor.native.ownerWebContentsId === native.native.ownerWebContentsId &&
        editor.native.windowId === native.native.windowId,
      "Editor escaped Browser owner",
    );
    evidence.editor = editor.native;
    evidence.geometryCollapsed = await geometry(editor);
    stage("edit-design");
    await editor.page.getByTestId("browser-design-editor").evaluate((node) => {
      node.open = true;
    });
    const change = async (name, value) => {
      await editor.page
        .getByLabel(name, { exact: true })
        .evaluate((field, value) => {
          const prototype =
            field.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(
            field,
            value,
          );
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
    };
    await change("font-size", revisedSize);
    evidence.cssPreview = await waitFor(
      options,
      () =>
        native.page.locator("h1").evaluate((node) => ({
          text: node.textContent,
          size: getComputedStyle(node).fontSize,
        })),
      (value) => value.size === revisedSize,
      "CSS preview missing before text edit",
    );
    await change(label("designText"), revisedText);
    const preview = () =>
      native.page.locator("h1").evaluate((node) => ({
        text: node.textContent,
        size: getComputedStyle(node).fontSize,
      }));
    evidence.preview = await waitFor(
      options,
      preview,
      (value) => value.text === revisedText && value.size === revisedSize,
      "Real design preview missing",
    );
    evidence.geometryExpanded = await geometry(editor);
    await shot(editor, "editor-design-expanded");
    await shot(native, "page-design-preview");
    stage("save-design-only");
    assert(
      evidence.geometryExpanded.dom.body === "",
      "Expected design-only draft",
    );
    await click(
      editor.page.getByRole("button", { name: label("save"), exact: true }),
    );
    const accessory = page.getByTestId("browser-annotation-accessory");
    await accessory
      .getByRole("button", { name: label("designTitle"), exact: true })
      .waitFor({ state: "visible" });
    const original = page.getByRole("button", {
      name: label("holdOriginal"),
      exact: true,
    });
    await original.evaluate((node) =>
      node.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    evidence.original = await waitFor(
      options,
      preview,
      (value) => value.text === baseline.text && value.size === baseline.size,
      "Original hold did not restore baseline",
    );
    await original.evaluate((node) =>
      node.dispatchEvent(
        new KeyboardEvent("keyup", { key: " ", bubbles: true }),
      ),
    );
    evidence.restored = await waitFor(
      options,
      preview,
      (value) => value.text === revisedText && value.size === revisedSize,
      "Original release did not restore design",
    );
    stage("send-from-composer");
    await click(
      accessory.getByRole("button", { name: label("sendAll"), exact: true }),
    );
    const read = await waitFor(
      options,
      () =>
        appServerCallFromPage(page, "thread/read", {
          threadId: identity.threadId,
          includeTurns: true,
        }),
      (read) =>
        read.result?.thread?.turns?.some(
          (turn) =>
            ["completed", "complete"].includes(
              String(turn.status).toLowerCase(),
            ) &&
            turn.items?.some(
              (item) =>
                item.type === "userMessage" &&
                JSON.stringify(item.content).includes(revisedText),
            ),
        ),
      "Design canonical turn did not complete",
    );
    const user = read.result.thread.turns
      .flatMap((turn) => turn.items)
      .find(
        (item) =>
          item.type === "userMessage" &&
          JSON.stringify(item.content).includes(revisedText),
      );
    const visibleMessage = page.locator(`[data-thread-item-id="${user.id}"]`);
    await visibleMessage.waitFor({ state: "visible" });
    const expand = visibleMessage.getByTestId("user-message-content-toggle");
    if (
      (await expand.count()) &&
      (await expand.getAttribute("aria-expanded")) === "false"
    )
      await click(expand);
    const readMessage = () =>
      visibleMessage.evaluate((node) => ({
        id: node.getAttribute("data-thread-item-id"),
        visible: !!node.getBoundingClientRect().height,
        text: node.querySelector('[data-testid="user-message-content-full"]')
          ?.textContent,
        contentVisible: ["expanded", "short"].includes(
          node
            .querySelector('[data-testid="collapsible-user-message-content"]')
            ?.getAttribute("data-user-message-content-state"),
        ),
        imageCount: node.querySelectorAll(
          'img[data-testid^="message-image-attachment-"]',
        ).length,
        images: Array.from(
          node.querySelectorAll(
            'img[data-testid^="message-image-attachment-"]',
          ),
        ).map((image) => ({
          src: image.src,
          complete: image.complete,
          width: image.naturalWidth,
        })),
      }));
    const imageUri = user.content.find((part) => part.type === "image")?.url;
    const mediaRead = imageUri
      ? await appServerCallFromPage(page, "media/read", {
          threadId: identity.threadId,
          uri: imageUri,
          offset: 0,
          length: 8_388_608,
        })
      : null;
    const message = await waitFor(
      options,
      readMessage,
      (value) =>
        value.contentVisible &&
        (!imageUri ||
          (value.imageCount === 1 &&
            value.images[0]?.complete &&
            value.images[0].width > 0)),
      "Canonical screenshot did not load in the user message",
      (value) => ({
        id: value.id,
        imageCount: value.imageCount,
        images: value.images.map(({ complete, width }) => ({
          complete,
          width,
        })),
      }),
    );
    if (mediaRead?.result?.contentBase64)
      await fs.writeFile(
        path.join(output, "canonical-annotation.png"),
        Buffer.from(mediaRead.result.contentBase64, "base64"),
      );
    await accessory.waitFor({ state: "detached" });
    const latestTrace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
    );
    const commands = await readBrowserAnnotationCommands(app, key);
    const capture = commands.findLast(
      (command) => command.command === "browser_tab_capture_annotation",
    );
    evidence.capture = capture;
    evidence.submission = summarizeBrowserDesignSubmission({
      trace: [...ctx.readInvokeTrace(), ...latestTrace],
      read,
      providerRequests: providerFixture.requests,
      threadId: identity.threadId,
      pageUrl: initial.address,
      previousText: baseline.text,
      revisedText,
      previousSize: baseline.size,
      revisedSize,
      capture,
      message,
      mediaRead,
    });
    const final = await ctx.readBrowserWorkspaceState(page);
    evidence.final = final;
    evidence.host = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence,
    );
    await shot(
      { native: { webContentsId: native.native.ownerWebContentsId } },
      "renderer-submitted",
    );
    evidence.assertions = {
      ...evidence.submission.checks,
      editorActionsFit:
        evidence.geometryExpanded.dom.saveDisabled === false &&
        evidence.geometryExpanded.dom.card.bottom <=
          evidence.geometryExpanded.dom.innerHeight &&
        evidence.geometryExpanded.dom.save.top >= 0 &&
        evidence.geometryExpanded.dom.save.bottom <=
          evidence.geometryExpanded.dom.innerHeight &&
        evidence.geometryExpanded.dom.innerHeight ===
          evidence.geometryExpanded.native.bounds.height,
      annotationCommandsSucceeded: commands.every(
        (command) => command.status === "success",
      ),
      acceptedDraftConsumed: (await accessory.count()) === 0,
      sameBrowserIdentity: [
        "threadId",
        "sessionId",
        "tabId",
        "viewId",
        "webContentsId",
      ].every((key) => initial[key] === final[key]),
      hiddenRealHost:
        evidence.host?.visibilityOnly === true &&
        evidence.host.unexpectedShowEvents === 0 &&
        evidence.host.preloadErrors.length === 0,
      noErrors:
        evidence.diagnostics.consoleErrors.length === 0 &&
        evidence.diagnostics.pageErrors.length === 0,
    };
    evidence.failedAssertions = Object.entries(evidence.assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    evidence.result = evidence.failedAssertions.length ? "fail" : "pass";
    stage("complete");
    return evidence;
  } catch (error) {
    evidence.error = String(error.stack ?? error);
    throw error;
  } finally {
    evidence.completedAt = new Date().toISOString();
    evidence.commands = await readBrowserAnnotationCommands(app, key);
    evidence.events = await app
      .evaluate((_electron, key) => globalThis[key]?.records ?? [], key)
      .catch(() => []);
    await fs.writeFile(
      path.join(output, "design-diagnostics.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await app
      .evaluate((_electron, key) => {
        globalThis[key]?.close();
        delete globalThis[key];
      }, key)
      .catch(() => undefined);
  }
}
