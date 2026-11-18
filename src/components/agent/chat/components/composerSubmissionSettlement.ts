import { useSyncExternalStore } from "react";
import { logAgentDebug } from "@/lib/agentDebug";
import type { ComposerController } from "@/components/input-kit/ComposerController";
import type {
  ComposerDraftCapture,
  ComposerDraftCoordinator,
} from "@/components/input-kit/ComposerDraftCoordinator";
import type {
  ComposerDraftSnapshot,
  ComposerSubmitTarget,
} from "@/components/input-kit/types";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";
import type { InterruptedInputRestoreRequest } from "../hooks/agentStreamInputRestoreTypes";
import {
  createRuntimeSubmissionCapture,
  normalizeRuntimeSubmissionResult,
  runRuntimeSubmissionEffect,
  type AcceptedRuntimeSubmissionResult,
} from "../hooks/agentSendResult";

/** This object is an in-process capability; it must never enter a wire payload. */
export interface ComposerSubmissionRestoreToken {
  readonly kind: "composer-submission";
}
export type ScopedComposerRestoreRequest = InterruptedInputRestoreRequest & {
  composerRestoreToken?: ComposerSubmissionRestoreToken;
};
type SurfaceScope = {
  projectId?: string | null;
  sessionId?: string | null;
};
type RestoreContext = {
  controller: ComposerController;
  coordinator?: ComposerDraftCoordinator;
  transientScope: SurfaceScope;
  revision: number | null;
  generation: number | null;
  scope: DraftScope | null;
  state: "pending" | "ready" | "blocked";
  listeners: Set<() => void>;
};
const restores = new WeakMap<ComposerSubmissionRestoreToken, RestoreContext>();

function publishRestore(
  context: RestoreContext,
  state: RestoreContext["state"],
  reason: string,
): void {
  context.state = state;
  const status = context.coordinator?.getSnapshot();
  logAgentDebug(
    "ComposerSubmission",
    "restoreState",
    {
      state,
      reason,
      expectedRevision: context.revision,
      currentRevision: context.controller.getSnapshot().revision,
      expectedGeneration: context.generation,
      currentGeneration: status?.generation ?? null,
      hasIdentity: status?.identity != null,
      sameScope: sameScope(status?.scope ?? null, context.scope),
    },
    { consoleOnly: true },
  );
  for (const listener of context.listeners) {
    try {
      listener();
    } catch {
      /* UI listeners do not own settlement. */
    }
  }
}

/** Pending cleanup must retain an interrupted restore request until consumption settles. */
export function useComposerSubmissionRestoreState(
  token?: ComposerSubmissionRestoreToken,
) {
  return useSyncExternalStore(
    (listener) => {
      const context = token && restores.get(token);
      if (!context) return () => undefined;
      context.listeners.add(listener);
      return () => {
        context.listeners.delete(listener);
      };
    },
    () => (token ? (restores.get(token)?.state ?? "blocked") : "blocked"),
    () => "blocked",
  );
}

function sameScope(a: DraftScope | null, b: DraftScope | null): boolean {
  return (
    !!a &&
    !!b &&
    a.workspaceId === b.workspaceId &&
    a.kind === b.kind &&
    a.id === b.id
  );
}

export function canRestoreComposerSubmission({
  controller,
  coordinator,
  token,
  scope,
}: {
  controller: ComposerController;
  coordinator?: ComposerDraftCoordinator;
  token?: ComposerSubmissionRestoreToken;
  scope: SurfaceScope;
}): boolean {
  const context = token && restores.get(token);
  const status = coordinator?.getSnapshot();
  const reject = (reason: string): false => {
    logAgentDebug(
      "ComposerSubmission",
      "inputRestoreGuard.rejected",
      {
        reason,
        hasToken: Boolean(token),
        hasContext: Boolean(context),
        state: context?.state ?? null,
        sameController: context?.controller === controller,
        sameCoordinator: context?.coordinator === coordinator,
        expectedRevision: context?.revision ?? null,
        currentRevision: controller.getSnapshot().revision,
        expectedGeneration: context?.generation ?? null,
        currentGeneration: status?.generation ?? null,
        hasIdentity: status?.identity != null,
        sameScope: sameScope(status?.scope ?? null, context?.scope ?? null),
      },
      { consoleOnly: true },
    );
    return false;
  };
  if (!token) return !coordinator || reject("missing_token");
  if (!context) return reject("unknown_token");
  if (context.controller !== controller) return reject("controller_changed");
  if (context.coordinator !== coordinator) return reject("coordinator_changed");
  if (context.revision === null) return reject("cleanup_not_committed");
  if (controller.getSnapshot().revision !== context.revision)
    return reject("revision_changed");
  if (!coordinator)
    return (
      ((scope.projectId ?? null) ===
        (context.transientScope.projectId ?? null) &&
        (scope.sessionId ?? null) ===
          (context.transientScope.sessionId ?? null)) ||
      reject("surface_scope_changed")
    );
  return (
    (status?.identity === null &&
      status.generation === context.generation &&
      sameScope(status.scope, context.scope)) ||
    reject("binding_changed")
  );
}

/** Capture once; acceptance starts persistence without delaying the runtime result. */
export function createComposerSubmissionSettlement({
  controller,
  coordinator,
  target,
  scope,
  canApplyUi,
  onAccepted,
  onDraftAccepted,
  onCommitted,
}: {
  controller?: ComposerController;
  coordinator?: ComposerDraftCoordinator;
  target: ComposerSubmitTarget;
  scope: SurfaceScope;
  canApplyUi: () => boolean;
  onAccepted?: (
    result: AcceptedRuntimeSubmissionResult,
    draft?: ComposerDraftSnapshot,
  ) => void;
  onDraftAccepted?: (
    capture: ComposerDraftCapture,
    result: AcceptedRuntimeSubmissionResult,
  ) => Promise<void> | void;
  onCommitted: (result: AcceptedRuntimeSubmissionResult) => void;
}) {
  if (coordinator && !controller)
    throw new Error("Persistent composer requires its Controller");
  const capture: ComposerDraftCapture | undefined =
    coordinator?.captureSubmission(target);
  const receipt = capture?.receipt ?? controller?.submit(target);
  const token: ComposerSubmissionRestoreToken | undefined =
    controller && receipt?.kind === "accepted"
      ? Object.freeze({ kind: "composer-submission" })
      : undefined;
  if (token && controller)
    restores.set(token, {
      controller,
      coordinator,
      transientScope: { ...scope },
      revision: null,
      generation: null,
      scope: null,
      state: "pending",
      listeners: new Set(),
    });

  const committed = (result: AcceptedRuntimeSubmissionResult) => {
    const context = token && restores.get(token);
    if (context && receipt?.kind === "accepted") {
      // A listener may already have edited again before the cleanup promise resolves.
      if (controller?.getSnapshot().revision !== receipt.revision + 1) {
        publishRestore(context, "blocked", "revision_changed_during_commit");
        return;
      }
      if (coordinator) {
        const status = coordinator.getSnapshot();
        if (
          !capture?.binding ||
          status.generation !== capture.binding.generation ||
          status.identity !== null
        ) {
          publishRestore(context, "blocked", "binding_changed_during_commit");
          return;
        }
        context.scope = status.scope;
        context.generation = status.generation;
      }
      context.revision = controller.getSnapshot().revision;
      publishRestore(context, "ready", "committed");
    }
    if (!canApplyUi()) return;
    runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
      onCommitted(result),
    );
  };
  let cleanup: Promise<boolean> | undefined;
  const runtime = createRuntimeSubmissionCapture(undefined, (result) => {
    runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
      onAccepted?.(result, receipt?.draft),
    );
    if (coordinator && capture) {
      let promotion: Promise<void>;
      try {
        promotion = Promise.resolve(onDraftAccepted?.(capture, result));
      } catch (error) {
        promotion = Promise.reject(error);
      }
      promotion = promotion.catch(() => {
        runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () => {
          throw new Error("Composer promotion failed after acceptance");
        });
      });
      cleanup = coordinator
        .settleSubmission(capture, result, promotion)
        .then((applied) => {
          if (applied) committed(result);
          else {
            const context = token && restores.get(token);
            if (context)
              publishRestore(context, "blocked", "consume_not_applied");
          }
          return applied;
        })
        .catch(() => {
          runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () => {
            throw new Error("Composer cleanup failed after acceptance");
          });
          const context = token && restores.get(token);
          if (context) publishRestore(context, "blocked", "consume_failed");
          return false;
        });
      return;
    }
    if (
      !canApplyUi() ||
      (receipt?.kind === "accepted" && !controller?.commit(receipt))
    ) {
      const context = token && restores.get(token);
      if (context) publishRestore(context, "blocked", "commit_rejected");
      cleanup = Promise.resolve(false);
      return;
    }
    cleanup = Promise.resolve(true);
    committed(result);
  });
  return {
    receipt,
    /** Local persistence/UI cleanup only; runtime send must not await it. */
    get cleanup() {
      return cleanup;
    },
    composerRestoreToken: token,
    composerDraftCapture: capture,
    onRuntimeAccepted: runtime.observer.onRuntimeAccepted,
    finish: (result: unknown) =>
      runtime.finish(normalizeRuntimeSubmissionResult(result)),
    reject: runtime.reject,
  };
}
