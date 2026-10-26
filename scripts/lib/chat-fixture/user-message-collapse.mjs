import { setTimeout as delay } from "node:timers/promises";
import {
  startClipboardWriteObservation,
  stopClipboardWriteObservation,
  summarizeClipboardWriteObservation,
  summarizeClipboardCopyProof,
} from "./user-message-collapse-clipboard-observation.mjs";
import { collapseTextIdentity } from "./user-message-collapse-evidence.mjs";

export async function copyUserMessageFullText({
  page,
  copyButton,
  readClipboardText,
  writeClipboardText,
  expectedText,
  phase,
  timeoutMs = 30_000,
  ensureVisible = async () => undefined,
}) {
  if (
    typeof readClipboardText !== "function" ||
    typeof writeClipboardText !== "function" ||
    typeof page?.evaluate !== "function" ||
    typeof expectedText !== "string" ||
    expectedText.length === 0 ||
    (await copyButton.count()) !== 1
  )
    throw new Error("invalid exact UserMessage clipboard contract");
  const readText = async () => {
    const text = await readClipboardText();
    if (typeof text !== "string")
      throw new Error("real Electron clipboard readback did not return text");
    return text;
  };
  const originalClipboard = await readText();
  let failure;
  let actionFailed = false;
  let handle;
  let observation;
  let sentinel;
  let copied;
  let result;
  let buttonClicked = false;
  let sentinelObserved = false;
  const proof = () =>
    summarizeClipboardCopyProof({
      sentinelObserved,
      buttonClicked,
      fullTextMatched: copied === expectedText,
      textIdentity: collapseTextIdentity(copied),
      actualReadObserved: typeof copied === "string",
      actualEqualsExpected: copied === expectedText,
      actualEqualsSentinel: typeof copied === "string" && copied === sentinel,
      actualTextUtf16Length: typeof copied === "string" ? copied.length : null,
      clipboardWriteObservation: observation,
    });
  try {
    sentinel = `lime-user-message-collapse-${phase}-${Date.now()}`;
    if (sentinel === expectedText)
      throw new Error("clipboard sentinel collision");
    await writeClipboardText(sentinel);
    sentinelObserved = (await readText()) === sentinel;
    if (!sentinelObserved)
      throw new Error("real clipboard sentinel was not delivered");
    await ensureVisible(copyButton);
    handle = await startClipboardWriteObservation(page, expectedText);
    await copyButton.click();
    buttonClicked = true;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      copied = await readText();
      if (copied === expectedText) break;
      await delay(50);
    }
    result = proof();
    return result;
  } catch (error) {
    actionFailed = true;
    failure = error;
    throw error;
  } finally {
    let cleanupFailure;
    let observationCleanupFailed = false;
    let restoreFailed = false;
    if (handle) {
      try {
        observation = summarizeClipboardWriteObservation(
          await stopClipboardWriteObservation(page, handle),
          handle,
        );
        if (!observation.intervalComplete)
          throw new Error("passive clipboard observation is incomplete");
      } catch (error) {
        cleanupFailure = error;
        observationCleanupFailed = true;
      }
    }
    try {
      await writeClipboardText(originalClipboard);
      if ((await readText()) !== originalClipboard)
        throw new Error("real Electron clipboard restoration did not match");
    } catch (error) {
      cleanupFailure ??= error;
      restoreFailed = true;
    }
    if (result) Object.assign(result, proof());
    if (actionFailed || cleanupFailure) {
      const primary = actionFailed ? failure : cleanupFailure;
      try {
        Object.defineProperty(primary, "clipboardCopyEvidence", {
          value: proof(),
          configurable: true,
        });
        if (restoreFailed)
          Object.defineProperty(primary, "clipboardRestoreFailed", {
            value: true,
            configurable: true,
          });
        if (observationCleanupFailed)
          Object.defineProperty(primary, "clipboardObservationCleanupFailed", {
            value: true,
            configurable: true,
          });
      } catch {}
      if (!actionFailed) throw cleanupFailure;
    }
  }
}
