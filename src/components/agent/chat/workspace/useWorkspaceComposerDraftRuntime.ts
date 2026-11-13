import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ComposerController } from "@/components/input-kit/ComposerController";
import {
  ComposerDraftCoordinator,
  type ComposerDraftBindingToken,
  type ComposerDraftCapture,
  type ComposerDraftStatus,
} from "@/components/input-kit/ComposerDraftCoordinator";
import type { NewConversationRequest } from "@/lib/workspace/navigation";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";
import type { AcceptedRuntimeSubmissionResult } from "../hooks/agentSendResult";

function sameScope(left: DraftScope | null, right: DraftScope | null) {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.workspaceId === right.workspaceId &&
      left.kind === right.kind &&
      left.id === right.id,
    )
  );
}

const emptySnapshot = () => null;
const emptySubscribe = () => () => undefined;

/** React commits the editing target; Controller remains the sole document owner. */
export function useWorkspaceComposerDraftRuntime({
  controller,
  initialScope,
}: {
  controller: ComposerController;
  initialScope: DraftScope | null;
}) {
  const [coordinator, setCoordinator] =
    useState<ComposerDraftCoordinator | null>(null);
  const [committedScope, setCommittedScope] = useState(initialScope);
  const [committedRequest, setCommittedRequest] =
    useState<NewConversationRequest | null>(null);
  const latestRequest = useRef<NewConversationRequest | null>(null);
  const handledFreshRequest = useRef<number | null>(null);
  const intendedScope = useRef(initialScope);
  const [restoring, setRestoring] = useState(true);
  const mountScope = useRef(initialScope);
  const explicitScope = useRef(false);
  const mounted = useRef(false);
  const activeOwner = useRef<ComposerDraftCoordinator | null>(null);
  const readEpoch = useRef(0);
  const navigationEpoch = useRef(0);

  // Effects own subscriptions so StrictMode's abandoned render cannot leak an owner.
  useLayoutEffect(() => {
    const owner = new ComposerDraftCoordinator(controller, {
      plainTextMode: false,
    });
    mounted.current = true;
    activeOwner.current = owner;
    setCoordinator(owner);
    void owner.connect();
    return () => {
      mounted.current = false;
      if (activeOwner.current === owner) activeOwner.current = null;
      readEpoch.current += 1;
      owner.detach();
    };
  }, [controller]);

  useLayoutEffect(() => {
    if (!explicitScope.current) {
      intendedScope.current = initialScope;
      setCommittedScope((current) =>
        sameScope(current, initialScope) ? current : initialScope,
      );
    }
  }, [initialScope]);

  useLayoutEffect(() => {
    if (!coordinator || !committedScope) return;
    explicitScope.current = true;
    const epoch = ++readEpoch.current;
    const navigation = navigationEpoch.current;
    setRestoring(true);
    const current = () =>
      mounted.current &&
      activeOwner.current === coordinator &&
      readEpoch.current === epoch &&
      navigationEpoch.current === navigation &&
      sameScope(intendedScope.current, committedScope) &&
      (!committedRequest || latestRequest.current?.id === committedRequest.id);
    void (async () => {
      await coordinator.bindCommitted(committedScope);
      if (
        current() &&
        committedRequest?.freshDraft &&
        handledFreshRequest.current !== committedRequest.id &&
        latestRequest.current?.id === committedRequest.id &&
        committedScope.kind === "home" &&
        committedScope.workspaceId === committedRequest.workspaceId
      ) {
        handledFreshRequest.current = committedRequest.id;
        await coordinator.replaceCommittedDraft(committedScope, current);
      }
      if (current()) {
        setRestoring(false);
        if (committedRequest)
          document
            .querySelector<HTMLElement>(
              '[data-composer-editor-host="true"] [role="textbox"]',
            )
            ?.focus();
      }
    })();
  }, [coordinator, committedScope, committedRequest]);

  const status = useSyncExternalStore<ComposerDraftStatus | null>(
    coordinator?.subscribe ?? emptySubscribe,
    coordinator?.getSnapshot ?? emptySnapshot,
    coordinator?.getSnapshot ?? emptySnapshot,
  );
  const prepareComposerDraftNavigation = useCallback(() => {
    coordinator?.prepareNavigation();
  }, [coordinator]);
  const commitComposerDraftScope = useCallback((scope: DraftScope) => {
    if (sameScope(intendedScope.current, scope)) return;
    navigationEpoch.current += 1;
    intendedScope.current = scope;
    explicitScope.current = true;
    setCommittedScope((current) =>
      sameScope(current, scope) ? current : scope,
    );
  }, []);
  const commitNewConversationRequest = useCallback(
    (request: NewConversationRequest) => {
      if (latestRequest.current?.id === request.id) return;
      coordinator?.prepareNavigation();
      const scope: DraftScope = {
        workspaceId: request.workspaceId,
        kind: "home",
        id: "new-conversation",
      };
      if (request.freshDraft && sameScope(intendedScope.current, scope))
        navigationEpoch.current += 1;
      commitComposerDraftScope(scope);
      latestRequest.current = request;
      setCommittedRequest(request);
    },
    [coordinator, commitComposerDraftScope],
  );
  const getComposerDraftNavigationEpoch = useCallback(
    () => navigationEpoch.current,
    [],
  );
  const getComposerDraftTarget = useCallback(() => intendedScope.current, []);

  const promoteComposerDraft = useCallback(
    async (
      token: ComposerDraftBindingToken,
      target: DraftScope,
      metadata: { sessionId: string; threadId?: string },
    ) => {
      if (!coordinator) return;
      const before = coordinator.getSnapshot();
      const capturedEpoch = navigationEpoch.current;
      const ownsVisibleDraft =
        before.generation === token.generation &&
        sameScope(before.scope, token.scope) &&
        sameScope(intendedScope.current, token.scope);
      if (!sameScope(token.scope, target)) {
        const applied = await coordinator.promote(token, target, {
          expectedTarget: null,
          ...metadata,
        });
        if (!applied) return;
      }
      // An old acceptance may move/consume its source without changing the new surface.
      if (
        mounted.current &&
        activeOwner.current === coordinator &&
        ownsVisibleDraft &&
        navigationEpoch.current === capturedEpoch &&
        sameScope(intendedScope.current, token.scope) &&
        coordinator.getSnapshot().generation === token.generation
      )
        commitComposerDraftScope(target);
    },
    [coordinator, commitComposerDraftScope],
  );

  const handleComposerDraftAccepted = useCallback(
    async (
      capture: ComposerDraftCapture,
      result: AcceptedRuntimeSubmissionResult,
    ) => {
      const token = capture.binding;
      if (!token) return;
      const executionScope =
        result.kind === "runtime-accepted"
          ? result.receipt.executionScope
          : undefined;
      if (
        executionScope &&
        executionScope.sourceWorkspaceId !== token.scope.workspaceId
      )
        return;
      await promoteComposerDraft(
        token,
        {
          workspaceId: executionScope?.workspaceId ?? token.scope.workspaceId,
          kind: "local",
          id: result.receipt.sessionId,
        },
        {
          sessionId: result.receipt.sessionId,
          threadId: result.receipt.threadId,
        },
      );
    },
    [promoteComposerDraft],
  );

  // Only an unavailable store for the initially committed scope unlocks the composer.
  // Later bind/transport failures on a different scope stay locked.
  const draftStorageUnavailable =
    status?.mutation === "unavailable" &&
    (status.scope == null || sameScope(status.scope, mountScope.current));
  return {
    composerDraftCoordinator: coordinator ?? undefined,
    composerDraftStatus: status,
    composerDraftRestoring:
      restoring ||
      (!draftStorageUnavailable &&
        (!coordinator ||
          !committedScope ||
          !status?.ready ||
          !sameScope(initialScope, status.scope))),
    prepareComposerDraftNavigation,
    commitComposerDraftScope,
    commitNewConversationRequest,
    getComposerDraftNavigationEpoch,
    getComposerDraftTarget,
    promoteComposerDraft,
    handleComposerDraftAccepted,
  };
}
