#!/usr/bin/env node
import { readComposerEditorText } from "../lib/composer-editor-dom.mjs";

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { ensureElectronFixtureBuild } from "../lib/electron-fixture-build.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  appServerCallFromPage,
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
  parseInvokeTraceRaw,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../electron/mcp-config-fixture-smoke.mjs";
import {
  ensureDefaultWorkspace,
  initializeAppServer,
} from "../lib/chat-fixture/rpc.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "./tool-execution-current-contract.mjs";

const options = { timeoutMs: 120_000, intervalMs: 250 };
const output = path.resolve(
  process.env.LIME_COMMAND_CONTINUATION_EVIDENCE ||
    ".lime/qc/gui-evidence/command-continuation/summary.json",
);

async function waitForRead(page, threadId, predicate) {
  const deadline = Date.now() + options.timeoutMs;
  let thread;
  while (Date.now() < deadline) {
    thread = (
      await appServerCallFromPage(page, "thread/read", {
        threadId,
        includeTurns: true,
      })
    ).result.thread;
    if (predicate(thread)) return thread;
    await delay(options.intervalMs);
  }
  throw new Error(
    `Command continuation read timeout: ${JSON.stringify(thread)}`,
  );
}

function command(thread, id) {
  return thread.turns
    .flatMap((turn) => turn.items)
    .find((item) => item.id === id && item.type === "commandExecution");
}

function sidecarProcess(binary) {
  const lines = execFileSync("ps", ["-axo", "pid,ppid,command"], {
    encoding: "utf8",
  }).split("\n");
  const matches = lines.filter((line) => line.includes(`${binary} --`));
  equal(matches.length, 1, `expected one reviewed App Server: ${matches}`);
  const [, pid, parentPid] = matches[0].match(/^\s*(\d+)\s+(\d+)/u);
  return { pid: Number(pid), parentPid: Number(parentPid), binary };
}

async function openThread(page, threadId) {
  await page.evaluate((id) => {
    sessionStorage.setItem(
      "lime.appNavigation.restore.v1",
      JSON.stringify({ page: "agent", params: { initialSessionId: id } }),
    );
  }, threadId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const input = page.locator(
    `[data-testid="composer-editor"][role="textbox"][data-session-id="${threadId}"]`,
  );
  await input.waitFor({ state: "visible" });
  return input;
}

async function revealCommand(page, itemId) {
  const preview = '[data-testid^="message-list-historical-timeline-preview:"]';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const count = await page.locator(preview).count();
    if (!count) break;
    await page.locator(preview).first().click();
    await page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length < count,
      { selector: preview, count },
    );
  }
  const process =
    'details[data-testid*="agent-thread-block:"][data-testid$=":process"]:not([open])';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const count = await page.locator(process).count();
    if (!count) break;
    await page.locator(process).first().locator("summary").click();
    await page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length < count,
      { selector: process, count },
    );
  }
  const row = page.locator(
    `[data-testid="tool-call-row"][data-tool-call-id="${itemId}"]`,
  );
  await row.waitFor({ state: "visible" });
  return row;
}

async function run() {
  ok(process.platform !== "win32", "this fixture requires Unix shell and ps");
  const binary = process.env.APP_SERVER_BIN;
  const powershell = process.env.LIME_POWERSHELL_BIN;
  ok(binary, "APP_SERVER_BIN must select the reviewed frozen artifact");
  await mkdir(path.dirname(output), { recursive: true });
  ensureElectronFixtureBuild({ rootDir: process.cwd() });
  const runtimeEnv = createTempRuntimeEnv();
  const consoleErrors = [];
  const pageErrors = [];
  const summary = {
    ok: false,
    backend: "runtime",
    liveProviderUsed: false,
    tempRoot: runtimeEnv.tempRoot,
    binary,
    shell: powershell || "/bin/sh",
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
    scenarios: [],
    consoleErrors,
    pageErrors,
  };
  const fixture = await startOpenAiCompatibleFixtureServer({
    model: "command-continuation-desktop",
    scriptedResponses: [1, 2].flatMap((index) => [
      {
        type: "tool_call",
        name: "exec_command",
        id: `desktop-background-${index}`,
        arguments: {
          cmd: powershell
            ? `Write-Output 'COMMAND_SHUTDOWN_READY_${index}'; Write-Output 'Restart-Computer'; while (-not (Test-Path .release-${index})) { Start-Sleep -Milliseconds 25 }; Write-Output 'COMMAND_TAIL_${index}'`
            : `printf '\\033[?1h\\033=COMMAND_SHUTDOWN_READY_${index}\\n'; while [ ! -f .release-${index} ]; do sleep 0.025; done; printf 'COMMAND_TAIL_${index}\\n'`,
          shell: powershell || "/bin/sh",
          login: false,
          tty: true,
          yield_time_ms: 250,
        },
      },
      { type: "text", content: `MODEL_DONE_${index}` },
    ]),
  });
  let handle;
  try {
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv: resolveElectronAppServerRuntimeEnv({
        env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
      }),
      consoleErrors,
      pageErrors,
      backendMode: "runtime",
    });
    const { page } = handle;
    summary.url = page.url();
    summary.preload = await page.evaluate(() => ({
      electron: window.__LIME_ELECTRON__ === true,
      invoke: typeof window.electronAPI?.invoke === "function",
    }));
    deepStrictEqual(summary.preload, { electron: true, invoke: true });
    summary.sidecar = sidecarProcess(binary);
    equal(summary.sidecar.parentPid, handle.app.process().pid);
    const requestLog = [];
    summary.initialize = await initializeAppServer(page, requestLog);
    const workspace = await ensureDefaultWorkspace(page, requestLog);
    ok(
      workspace.rootPath?.startsWith(`${runtimeEnv.tempRoot}${path.sep}`),
      "fixture workspace must remain inside the isolated runtime directory",
    );
    const provider = await provisionToolExecutionFixtureProvider({
      fixture,
      invoke: async (_options, method, params) =>
        (await appServerCallFromPage(page, method, params)).result,
    });
    const thread = (
      await appServerCallFromPage(page, "thread/start", {
        ...buildToolExecutionThreadStartParams({
          provider,
          workspaceRoot: workspace.rootPath,
          title: "Desktop command continuation",
        }),
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      })
    ).result.thread;
    summary.threadId = thread.id;
    let input = await openThread(page, thread.id);
    await page
      .getByTestId("inputbar-access-mode-select")
      .selectOption("full-access");
    for (const index of [1, 2]) {
      const id = `item_desktop-background-${index}`;
      summary.activeScenario = { index, itemId: id, stage: "send" };
      await input.fill(`Run command continuation fixture ${index}.`);
      await page.getByTestId("send-btn").click();
      await page
        .getByText(`MODEL_DONE_${index}`, { exact: false })
        .first()
        .waitFor();
      const initial = await waitForRead(
        page,
        thread.id,
        (value) =>
          value.turns.length === index &&
          value.turns.at(-1).status === "completed",
      );
      equal(command(initial, id)?.status, "inProgress");
      const original = command(initial, id);
      ok(original.processId, "command must have an actual OS process");
      equal(fixture.requests.length, index * 2);
      const turnId = initial.turns.at(-1).id;
      summary.activeScenario = {
        index,
        itemId: id,
        turnId,
        processId: original.processId,
        stage: index === 2 ? "rendererReload" : "outputDisclosure",
      };
      if (index === 2) {
        // Only the renderer reloads; the same real process continues in the same App Server.
        input = await openThread(page, thread.id);
        deepStrictEqual(sidecarProcess(binary), summary.sidecar);
        await page
          .getByText(`MODEL_DONE_${index}`, { exact: false })
          .first()
          .waitFor();
        await page.waitForFunction(
          ({ itemId, processId }) =>
            window.__LIME_AGENTUI_PERF__
              ?.entries?.()
              .some(
                (entry) =>
                  entry.phase === "agentStream.commandResume.bound" &&
                  entry.metrics.itemId === itemId &&
                  entry.metrics.processId === processId &&
                  entry.metrics.status === "in_progress",
              ),
          { itemId: id, processId: original.processId },
        );
      }
      const row = await revealCommand(page, id);
      const running = await waitForRead(page, thread.id, (value) =>
        command(value, id)?.aggregatedOutput?.includes(
          `COMMAND_SHUTDOWN_READY_${index}`,
        ),
      );
      const runningItem = command(running, id);
      equal(runningItem.status, "inProgress");
      equal(runningItem.processId, original.processId);
      ok(
        runningItem.aggregatedOutput.includes("\u001b[?1h\u001b="),
        "raw canonical output must keep actual terminal sequences",
      );
      const outputOwner = row.locator("..");
      const resultPanel = outputOwner.getByTestId("tool-call-result-panel");
      if (!(await resultPanel.isVisible())) {
        const disclosure = row.locator("button[aria-expanded]");
        await disclosure.waitFor({ state: "visible" });
        await disclosure.click();
      }
      await resultPanel.waitFor({ state: "visible" });
      const transcript = resultPanel.locator(
        '[data-testid="markdown-plain-code-content"], [data-testid^="tool-call-command-output-"] pre',
      );
      await transcript
        .filter({ hasText: `COMMAND_SHUTDOWN_READY_${index}` })
        .first()
        .waitFor();
      const visibleOutput = await transcript.allTextContents();
      equal(
        visibleOutput
          .map((text) => text.replace(/\r\n/gu, "\n").trimEnd())
          .join("\n"),
        `COMMAND_SHUTDOWN_READY_${index}${powershell ? "\nRestart-Computer" : ""}`,
        "running transcript must contain every actual output line exactly once",
      );
      ok(
        visibleOutput.some((text) =>
          text.startsWith(`COMMAND_SHUTDOWN_READY_${index}`),
        ),
        "running transcript must display actual output without a private CSI prefix",
      );
      ok(
        visibleOutput.every(
          (text) => !text.includes("[?1h") && !text.includes("\u001b"),
        ),
        "terminal sequences must not leak into visible transcript",
      );
      if (powershell)
        ok(visibleOutput.some((text) => text.includes("Restart-Computer")));
      equal(await row.getAttribute("data-tool-status"), "running");
      const runningScreenshot = output.replace(
        /\.json$/u,
        `-running-${index}.png`,
      );
      await page.screenshot({ path: runningScreenshot, fullPage: true });
      await input.fill(`draft while command ${index} runs`);
      equal(
        await readComposerEditorText(input),
        `draft while command ${index} runs`,
      );
      ok(
        await page.getByTestId("send-btn").isEnabled(),
        "composer must remain usable",
      );
      await writeFile(
        path.join(workspace.rootPath, `.release-${index}`),
        "release\n",
      );
      summary.activeScenario.stage = "autonomousCompletion";
      await page.waitForFunction(
        (itemId) =>
          document
            .querySelector(`[data-tool-call-id="${itemId}"]`)
            ?.getAttribute("data-tool-status") === "completed",
        id,
      );
      // The disclosure remains open when the original process completes.
      await resultPanel.waitFor({ state: "visible" });
      await resultPanel
        .getByText(`COMMAND_TAIL_${index}`, { exact: false })
        .first()
        .waitFor();
      await resultPanel
        .getByText(`COMMAND_SHUTDOWN_READY_${index}`, { exact: false })
        .first()
        .waitFor();
      if (powershell) {
        await resultPanel
          .getByText("Restart-Computer", { exact: false })
          .first()
          .waitFor();
      }
      let resumeNotifications;
      if (index === 2) {
        resumeNotifications = await page.evaluate(
          (itemId) =>
            window.__LIME_AGENTUI_PERF__
              ?.entries?.()
              .filter(
                (entry) =>
                  entry.phase === "agentStream.commandResume.notification" &&
                  entry.metrics.itemId === itemId,
              ),
          id,
        );
        ok(
          resumeNotifications.some(
            (entry) =>
              entry.metrics.method === "item/commandExecution/outputDelta",
          ),
          "reload must consume actual Command output notifications",
        );
        equal(
          resumeNotifications.filter(
            (entry) => entry.metrics.method === "item/completed",
          ).length,
          1,
          "reload must consume exactly one actual Command completion",
        );
        ok(
          resumeNotifications.every(
            (entry) =>
              entry.sessionId === thread.id &&
              entry.metrics.turnId === turnId &&
              entry.metrics.processId === original.processId,
          ),
          "restored notifications must keep the original canonical scope",
        );
      }
      const completed = await waitForRead(
        page,
        thread.id,
        (value) => command(value, id)?.status === "completed",
      );
      summary.activeScenario.canonical = {
        status: command(completed, id).status,
        processId: command(completed, id).processId,
        tailPresent: command(completed, id).aggregatedOutput.includes(
          `COMMAND_TAIL_${index}`,
        ),
      };
      equal(completed.turns.length, index);
      equal(
        fixture.requests.length,
        index * 2,
        "autonomous exit must not invoke the provider again",
      );
      equal(command(completed, id).processId, original.processId);
      ok(
        command(completed, id).aggregatedOutput.startsWith(
          runningItem.aggregatedOutput,
        ),
        "completion must preserve the original raw output prefix",
      );
      ok(
        (await transcript.allTextContents()).every(
          (text) => !text.includes("[?1h") && !text.includes("\u001b"),
        ),
      );
      equal(command(completed, id).exitCode, 0);
      ok(
        command(completed, id).aggregatedOutput.includes(
          `COMMAND_SHUTDOWN_READY_${index}`,
        ),
        "ordinary shutdown text survives shared shell policy and canonical output",
      );
      equal(completed.turns.at(-1).id, turnId);
      if (powershell) {
        ok(
          command(completed, id).aggregatedOutput.includes("Restart-Computer"),
        );
      }
      equal(
        await readComposerEditorText(input),
        `draft while command ${index} runs`,
      );
      summary.scenarios.push({
        kind: index === 1 ? "streaming" : "rendererReload",
        turnId,
        itemId: id,
        processId: original.processId,
        status: await row.getAttribute("data-tool-status"),
        outputVisible: true,
        runningOutputVisible: true,
        runningScreenshot,
        terminalSequencesHidden: true,
        rawCanonicalOutputPreserved: true,
        shutdownLiteralVisible: true,
        ...(powershell ? { powershellLiteralVisible: true } : {}),
        draftPreserved: true,
        ...(resumeNotifications ? { resumeNotifications } : {}),
      });
    }
    delete summary.activeScenario;
    const rawTrace = await page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    );
    const trace = parseInvokeTraceRaw(rawTrace);
    ok(
      trace.some(
        (entry) =>
          entry.command === "app_server_handle_json_lines" &&
          entry.transport === "electron-ipc",
      ),
    );
    const requests = parseJsonRpcRequestsFromInvokeTrace(rawTrace);
    summary.methods = [...new Set(requests.map((request) => request.method))];
    ok(
      summary.methods.includes("turn/start"),
      "GUI send must invoke current turn/start",
    );
    summary.mockFallbackCount = trace.filter((entry) =>
      /mock/iu.test(entry.transport ?? ""),
    ).length;
    equal(summary.mockFallbackCount, 0);
    equal(pageErrors.length, 0, JSON.stringify(pageErrors));
    await page.screenshot({
      path: output.replace(/\.json$/u, ".png"),
      fullPage: true,
    });
    summary.ok = true;
  } catch (error) {
    summary.error = error.stack ?? String(error);
    if (handle?.page && !handle.page.isClosed()) {
      await handle.page
        .screenshot({
          path: output.replace(/\.json$/u, "-failure.png"),
          fullPage: true,
        })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
    await closeElectronFixture(handle);
    await fixture.close();
  }
  console.log(`COMMAND_CONTINUATION_ELECTRON_GATE_B_OK evidence=${output}`);
}

await run();
