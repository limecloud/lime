import { appServerCallFromPage } from "../mcp-config-fixture-smoke.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "./mcp-config-fixture-evidence.mjs";
import {
  captureContinuousTraceBoundary,
  collapseTextIdentity,
  summarizeCollapseInputBoundary,
  summarizeUserMessageCanonicalPreservation,
} from "../../lib/chat-fixture/user-message-collapse-evidence.mjs";
import { copyUserMessageFullText } from "../../lib/chat-fixture/user-message-collapse.mjs";
import {
  extractClipboardCopyEvidence,
  summarizeClipboardCopyProof,
} from "../../lib/chat-fixture/user-message-collapse-clipboard-observation.mjs";
import {
  captureInvokeTraceCollector,
  withInvokeTraceCollector,
} from "../../lib/invoke-trace-collector.mjs";
import { bindLongListUserMessageProbe } from "./session-history-user-collapse-fixture.mjs";
import {
  THREAD_READ_LONG_LIST,
  THREAD_READ_LONG_LIST_USER_COLLAPSE,
} from "./session-history-long-list-fixture.mjs";
import {
  runCanonicalLongListCollapseColdRestartGate,
  runCanonicalLongListCollapseGate,
} from "./session-history-user-collapse-gate.mjs";
import {
  COLLAPSE_SELECTORS,
  assert,
  attachLongListCollapseFailure,
  extractLongListCollapseFailure,
} from "./session-history-user-collapse-geometry.mjs";
import { withLongListCollapseInputObservation } from "./session-history-user-collapse-input.mjs";

async function wheelCopyButtonIntoView(page, copyButton, timeoutMs) {
  const started = Date.now();
  await page.locator(COLLAPSE_SELECTORS.scroll).hover();
  while (Date.now() - started < timeoutMs) {
    const button = await copyButton.boundingBox();
    const viewport = await page
      .locator(COLLAPSE_SELECTORS.scroll)
      .boundingBox();
    assert(
      button && viewport,
      "canonical copy button 或 scroll container 没有实际几何",
    );
    if (
      button.y >= viewport.y + 2 &&
      button.y + button.height <= viewport.y + viewport.height - 2
    )
      return;
    await page.mouse.wheel(0, button.y - viewport.y - viewport.height / 2);
    await page.waitForTimeout(100);
  }
  throw new Error("真实 wheel 未把 canonical copy button 放入 viewport");
}

function createSharedLongListCollapseHooks(handle, options, collector) {
  const page = handle.page;
  let lastTrace;
  let traceCounts;
  let lastCopyEvidence;
  const trace = async () => {
    const capture = await captureInvokeTraceCollector(page, collector);
    traceCounts = {
      appendCount: capture.captureSequence,
      currentRingCount: capture.currentRingCount,
      invalidationCount: capture.invalidations?.length,
      hooksIntact: capture.hooksIntact === true,
    };
    lastTrace = captureContinuousTraceBoundary(
      capture,
      collector,
      parseJsonRpcRequestsFromInvokeTrace,
    );
    return lastTrace;
  };
  const read = (probe) =>
    appServerCallFromPage(page, "thread/read", {
      threadId: probe.threadId,
      includeTurns: true,
    });
  return {
    captureFailureBoundary: trace,
    copyDiagnostic: () => summarizeClipboardCopyProof(lastCopyEvidence),
    traceDiagnostic: () => ({
      complete: lastTrace?.complete === true,
      currentIpcOnly: lastTrace?.currentIpcOnly === true,
      errorCount: lastTrace?.errorCount,
      entryCount: lastTrace?.entryDigests?.length,
      inputCount: lastTrace?.inputs?.length,
      ...traceCounts,
    }),
    async verifyExactCopy({ probe, state, bubbleSelector }) {
      const footer = page
        .locator(bubbleSelector)
        .locator("..")
        .locator('[data-testid="user-message-footer"]');
      const copyButton = footer.getByRole("button", {
        name: "复制消息",
        exact: true,
      });
      let proof;
      try {
        proof = await copyUserMessageFullText({
          page,
          copyButton,
          readClipboardText: () =>
            handle.app.evaluate(({ clipboard }) => clipboard.readText()),
          writeClipboardText: (text) =>
            handle.app.evaluate(
              ({ clipboard }, value) => clipboard.writeText(value),
              text,
            ),
          expectedText: probe.text,
          phase: `canonical-long-list-${state}`,
          timeoutMs: options.timeoutMs,
          ensureVisible: (button) =>
            wheelCopyButtonIntoView(page, button, options.timeoutMs),
        });
      } catch (error) {
        lastCopyEvidence = extractClipboardCopyEvidence(error);
        throw error;
      }
      lastCopyEvidence = summarizeClipboardCopyProof(proof);
      const expectedIdentity = collapseTextIdentity(probe.text);
      return {
        match:
          proof.sentinelObserved === true &&
          proof.buttonClicked === true &&
          proof.fullTextMatched === true &&
          proof.textIdentity?.sha256 === expectedIdentity.sha256 &&
          proof.textIdentity?.length === expectedIdentity.length,
        sha256: proof.textIdentity?.sha256,
        textUtf16Length: proof.textIdentity?.length,
        readSource: "electron-main-clipboard",
        clipboardCopyEvidence: lastCopyEvidence,
      };
    },
    async beginReadOnly(probe) {
      const beforeRead = await read(probe);
      return { beforeRead, traceBefore: await trace() };
    },
    async finishReadOnly({ probe, checkpoint }) {
      const afterRead = await read(probe);
      const canonical = summarizeUserMessageCanonicalPreservation({
        expected: probe,
        beforeRead: checkpoint.beforeRead,
        afterRead,
      });
      const inputBoundary = summarizeCollapseInputBoundary({
        traceBefore: checkpoint.traceBefore,
        traceAfter: await trace(),
        expected: { ...probe, requireAcceptedSubmission: false },
      });
      const provenance = lastTrace?.provenance;
      return {
        traceComplete: inputBoundary.completeInputBoundary,
        canonicalUnchanged: Object.values(canonical).every(
          (value) => value === true,
        ),
        forbiddenMutationCount: inputBoundary.noAdditionalInput ? 0 : null,
        turnId: probe.turnId,
        itemId: probe.itemId,
        canonical,
        inputBoundary,
        traceProvenance: {
          mode: provenance?.mode,
          runId: provenance?.runId,
          startedAt: provenance?.startedAt,
          baselineAppendCount: checkpoint.traceBefore.provenance?.appendCount,
          finalAppendCount: provenance?.appendCount,
          baselineRingCount:
            checkpoint.traceBefore.provenance?.currentRingCount,
          finalRingCount: provenance?.currentRingCount,
        },
      };
    },
  };
}

async function runObservedLongListCollapsePhase(
  handle,
  options,
  probe,
  phase,
  run,
) {
  let hooks;
  let inputCompleted = false;
  let cleanupProof;
  try {
    const result = await withInvokeTraceCollector(
      handle.page,
      async (collector) => {
        hooks = createSharedLongListCollapseHooks(handle, options, collector);
        try {
          const result = await withLongListCollapseInputObservation(
            handle.page,
            probe,
            phase,
            () => run(hooks),
          );
          inputCompleted = true;
          return result;
        } catch (error) {
          await hooks.captureFailureBoundary().catch(() => undefined);
          throw error;
        }
      },
      (proof) => {
        cleanupProof = proof;
      },
    );
    return { ...result, traceCollectorCleanup: cleanupProof };
  } catch (error) {
    const existing = extractLongListCollapseFailure(error);
    throw await attachLongListCollapseFailure(error, handle.page, probe, {
      phase,
      stage:
        existing?.stage ??
        (inputCompleted
          ? "collector-cleanup"
          : hooks
            ? "trusted-input"
            : "initial-page"),
      observations: existing?.observations ?? {},
      clipboardCopyEvidence:
        extractClipboardCopyEvidence(error) ??
        existing?.clipboardCopyEvidence ??
        hooks?.copyDiagnostic(),
      trace: {
        ...hooks?.traceDiagnostic(),
        cleanupFailed:
          error.traceCollectorCleanupFailed === true || inputCompleted,
        nativeRestored: cleanupProof?.nativeRestored === true,
        cleanupComplete: cleanupProof?.complete === true,
      },
    });
  }
}

export async function runSessionHistoryUserCollapsePhase(handle, options) {
  const probe = bindLongListUserMessageProbe(
    THREAD_READ_LONG_LIST,
    THREAD_READ_LONG_LIST_USER_COLLAPSE,
  );
  return runObservedLongListCollapsePhase(
    handle,
    options,
    probe,
    "interactive",
    (hooks) =>
      runCanonicalLongListCollapseGate(handle.page, probe, hooks, options),
  );
}

export async function runSessionHistoryUserCollapseColdRestartPhase(
  handle,
  options,
  previous,
  oldProcess,
) {
  const probe = bindLongListUserMessageProbe(
    THREAD_READ_LONG_LIST,
    THREAD_READ_LONG_LIST_USER_COLLAPSE,
  );
  const restart = {
    previous,
    oldPid: oldProcess?.pid,
    newPid: handle.app.process().pid,
    oldProcessExited: Boolean(
      oldProcess &&
      (oldProcess.exitCode !== null || oldProcess.signalCode !== null),
    ),
    navigation: "sidebar",
  };
  return runObservedLongListCollapsePhase(
    handle,
    options,
    probe,
    "cold-restart",
    (hooks) =>
      runCanonicalLongListCollapseColdRestartGate(
        handle.page,
        probe,
        hooks,
        restart,
        options,
      ),
  );
}
