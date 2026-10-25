import type { SendMessageObserver } from "../hooks/agentChatShared";
import {
  createRuntimeSubmissionCapture,
  isRuntimeSubmissionAccepted,
  runRuntimeSubmissionEffect,
  type AcceptedRuntimeSubmissionResult,
  type RuntimeSubmissionResult,
} from "../hooks/agentSendResult";

export async function submitWorkspaceMessage(options: {
  observer?: SendMessageObserver;
  submit: (observer: SendMessageObserver) => Promise<RuntimeSubmissionResult>;
  onAccepted?: (result: AcceptedRuntimeSubmissionResult) => void;
  onRejected?: (error: unknown) => void;
}): Promise<RuntimeSubmissionResult> {
  const capture = createRuntimeSubmissionCapture(options.observer);
  try {
    const result = capture.finish(await options.submit(capture.observer));
    if (isRuntimeSubmissionAccepted(result)) {
      runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
        options.onAccepted?.(result),
      );
    }
    return result;
  } catch (error) {
    if (capture.accepted) return capture.reject(error);
    try {
      options.onRejected?.(error);
    } catch {
      console.error("[WorkspaceSend] rejection post-processing failed");
    }
    return { kind: "rejected", error };
  }
}

export async function withWorkspaceSubmissionCleanup(
  submit: () => Promise<RuntimeSubmissionResult>,
  cleanup: () => void,
): Promise<RuntimeSubmissionResult> {
  let result: RuntimeSubmissionResult = { kind: "unknown" };
  try {
    result = await submit();
    return result;
  } finally {
    if (isRuntimeSubmissionAccepted(result)) {
      runRuntimeSubmissionEffect(result.receipt, "accepted_submit", cleanup);
    } else {
      try {
        cleanup();
      } catch {
        console.error("[WorkspaceSend] submission cleanup failed");
      }
    }
  }
}
