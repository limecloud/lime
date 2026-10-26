/* global FormGeometry */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { assert } from "../lib/chat-fixture/utils.mjs";

/** Real Chromium geometry only. This is not the Desktop/App Server submission gate. */
const root = process.cwd();
const output = path.resolve(process.argv[2]);
await fs.mkdir(path.dirname(output), { recursive: true });
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const source = "electron/browserAnnotationFormText.ts";
const bundle = await build({
  entryPoints: [path.join(root, source)],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "FormGeometry",
  platform: "browser",
  target: "chrome142",
});
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lime-form-layout-"));
await fs.writeFile(
  path.join(temp, "main.cjs"),
  `const {app,BrowserWindow}=require('electron');app.on('window-all-closed',()=>app.quit());app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:800,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await w.loadURL('about:blank');});`,
);
let app;
const results = [];
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(temp, "main.cjs")],
  });
  const page = await app.firstWindow();
  await page.evaluate(
    (code) => (0, eval)(`${code}\nglobalThis.FormGeometry = FormGeometry;`),
    bundle.outputFiles[0].text,
  );
  await page.evaluate(() => {
    document.body.style.margin = "20px";
    const host = document.createElement("section");
    host.id = "host";
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML =
      '<textarea id="copy"></textarea>';
    const control = host.shadowRoot.querySelector("textarea");
    control.value =
      "First 😀 line with exact text.\nSecond 会话内置 browser text.\nThird form line.\nFourth visible after scrolling.\nFifth UTF-16 fixture.";
    Object.assign(control.style, {
      boxSizing: "border-box",
      width: "360px",
      height: "96px",
      padding: "4px 8px",
      border: "1px solid black",
      font: "16px/24px monospace",
      transformOrigin: "top left",
    });
  });
  for (const test of [
    { name: "shadow-forward", scroll: 0, scale: 1, backwards: false },
    { name: "shadow-scrolled", scroll: 34, scale: 1, backwards: false },
    { name: "shadow-scrolled-backward", scroll: 34, scale: 1, backwards: true },
    { name: "shadow-scaled", scroll: 0, scale: 1.2, backwards: true },
  ]) {
    // Collapse the prior native selection so the next press selects text instead of dragging it.
    await page.locator("#copy").press("ArrowRight");
    const bounds = await page.locator("#copy").evaluate((element, test) => {
      element.scrollTop = test.scroll;
      element.style.transform = `scale(${test.scale})`;
      return element.getBoundingClientRect().toJSON();
    }, test);
    const start = {
        x: bounds.x + 24 * test.scale,
        y: bounds.y + 17 * test.scale,
      },
      end = { x: bounds.x + 240 * test.scale, y: bounds.y + 65 * test.scale };
    const from = test.backwards ? end : start,
      to = test.backwards ? start : end;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const observed = await page.locator("#copy").evaluate((element) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
      value: element.value,
      scrollTop: element.scrollTop,
    }));
    const result = await page.evaluate(
      ({ from, to }) => {
        const control = document
          .querySelector("#host")
          .shadowRoot.querySelector("textarea");
        const before = {
          start: control.selectionStart,
          end: control.selectionEnd,
          direction: control.selectionDirection,
          value: control.value,
          scrollTop: control.scrollTop,
        };
        const gesture = FormGeometry.beginAnnotationFormText(from);
        const selected =
          gesture && FormGeometry.moveAnnotationFormText(gesture, to);
        const after = {
          start: control.selectionStart,
          end: control.selectionEnd,
          direction: control.selectionDirection,
          value: control.value,
          scrollTop: control.scrollTop,
        };
        return {
          selected,
          unchanged: JSON.stringify(before) === JSON.stringify(after),
          leaked: document.querySelectorAll(
            "[data-browser-comment-text-selection-mirror]",
          ).length,
        };
      },
      { from, to },
    );
    assert(result.selected, `${test.name}: no form selection`);
    assert(
      result.selected.targetText ===
        observed.value.slice(observed.start, observed.end) &&
        result.selected.textLocator.startOffset === observed.start &&
        result.selected.textLocator.endOffset === observed.end,
      `${test.name}: native oracle mismatch ${JSON.stringify({ observed, result })}`,
    );
    assert(
      result.selected.textLocator.direction ===
        (test.backwards ? "backward" : "forward"),
      `${test.name}: pointer direction mismatch`,
    );
    assert(
      result.unchanged && result.leaked === 0,
      `${test.name}: form or mirror lifetime changed`,
    );
    assert(
      result.selected.selectionRects.length > 1 &&
        result.selected.selectionRects.every(
          (rect) =>
            rect.x >= bounds.x &&
            rect.y >= bounds.y &&
            rect.x + rect.width <= bounds.right + 0.01 &&
            rect.y + rect.height <= bounds.bottom + 0.01,
        ),
      `${test.name}: selection rectangles outside control`,
    );
    await page.screenshot({ path: `${output}.${test.name}.png` });
    results.push({ ...test, observed, ...result });
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        status: "pass",
        proofLevel: "Real Electron Chromium geometry",
        claimBoundary:
          "Current production helper bundled unchanged into a test-owned page; hidden real Electron, native mouse offsets, shadow/scroll/scale and unchanged form state. No preload/IPC/App Server/editor/provider claim.",
        source,
        sourceSha256: createHash("sha256")
          .update(await fs.readFile(path.join(root, source)))
          .digest("hex"),
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ output, cases: results.length, status: "pass" }),
  );
} catch (error) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify({ status: "fail", error: String(error), results }, null, 2) +
      "\n",
  );
  throw error;
} finally {
  if (app) {
    // A fixture has no resident-app lifecycle. Bound shutdown to its own child process.
    let forced = false;
    const child = app.process();
    const timer = setTimeout(() => {
      forced = true;
      child.kill("SIGKILL");
    }, 5000);
    try {
      await app.close();
    } finally {
      clearTimeout(timer);
      console.log(
        JSON.stringify({
          fixtureCleanup: forced ? "owned-child-forced" : "graceful",
        }),
      );
    }
  }
}
