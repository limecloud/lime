import { act, useCallback, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { installCoordinatorHarness } from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import { useWorkspaceComposerDraftRuntime } from "./useWorkspaceComposerDraftRuntime";
import { useWorkspaceComposerDraftNavigation } from "./useWorkspaceComposerDraftNavigation";
import { useWorkspaceTaskCenterNavigationRuntime } from "./useWorkspaceTaskCenterNavigationRuntime";
import { savePersistedSessionWorkspaceId } from "../hooks/agentProjectStorage";
import {
  requestExplicitInitialSessionNavigation,
  resetInitialSessionNavigationDeduplicationForTests,
} from "./useWorkspaceInitialSessionNavigation";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const setup = installCoordinatorHarness({ safeInvoke, safeListen });
const roots: Array<{ root: Root; host: HTMLElement }> = [];
const ignore = () => undefined;
const emptyTopics: Parameters<
  typeof useWorkspaceTaskCenterNavigationRuntime
>[0]["topics"] = [];
const emptyTopicMap = new Map();

afterEach(() => {
  act(() => {
    for (const { root, host } of roots.splice(0)) {
      root.unmount();
      host.remove();
    }
  });
  resetInitialSessionNavigationDeduplicationForTests();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("initial session recovery with a newly mounted Composer owner", () => {
  it.each([false, true])(
    "restores a remounted session and editable draft with prior sidebar request=%s",
    async (explicit) => {
      const fixture = await setup();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const target = {
        workspaceId: "w",
        kind: "local" as const,
        id: "session",
      };
      fixture.seed(target, "unsent session draft");
      savePersistedSessionWorkspaceId(target.id, "w");
      if (explicit) requestExplicitInitialSessionNavigation(target.id);
      const hydrate = vi.fn(async () => undefined);
      let current!: ReturnType<typeof useWorkspaceComposerDraftRuntime>;
      function Surface() {
        const [sessionId, setSessionId] = useState<string | null>(null);
        const [projectId, setProjectId] = useState<string>();
        const pending = useRef<{
          topicId: string;
          targetProjectId: string;
        } | null>(null);
        const resolving = useRef(false);
        const home = useRef(false);
        const initialScope = useMemo(
          () => (sessionId ? { ...target, id: sessionId } : null),
          [sessionId],
        );
        current = useWorkspaceComposerDraftRuntime({
          controller: fixture.controller,
          initialScope,
        });
        const { handleTopicSwitchCommitted } =
          useWorkspaceComposerDraftNavigation({
            composerDraftRuntime: current,
            workspaceId: "w",
            projectSelectionSource: "external",
            normalizedInitialSessionId: target.id,
            sessionId,
            onTopicSwitchCommitted: ignore,
          });
        const originalSwitchTopic = useCallback(async (id: string) => {
          await hydrate();
          setSessionId(id);
        }, []);
        const deferTopicSwitch = useCallback(
          (topicId: string, targetProjectId: string) => {
            pending.current = { topicId, targetProjectId };
            setProjectId(targetProjectId);
          },
          [],
        );
        const consumePendingTopicSwitch = useCallback(
          (workspaceId?: string | null) => {
            if (pending.current?.targetProjectId !== workspaceId) return null;
            const result = pending.current;
            pending.current = null;
            return result;
          },
          [],
        );
        const startTopicProjectResolution = useCallback(() => {
          if (resolving.current) return false;
          resolving.current = true;
          return true;
        }, []);
        const finishTopicProjectResolution = useCallback(() => {
          resolving.current = false;
        }, []);
        useWorkspaceTaskCenterNavigationRuntime({
          agentEntry: "conversation",
          currentSessionId: sessionId,
          initialSessionId: target.id,
          normalizedInitialSessionId: target.id,
          externalProjectId: "w",
          projectId,
          taskCenterWorkspaceId: "w",
          composerDraftCoordinator: current.composerDraftCoordinator,
          getComposerDraftNavigationEpoch:
            current.getComposerDraftNavigationEpoch,
          onBeforeTopicSwitch: ignore,
          onAfterTopicSwitch: handleTopicSwitchCommitted,
          originalSwitchTopic,
          deferTopicSwitch,
          consumePendingTopicSwitch,
          startTopicProjectResolution,
          finishTopicProjectResolution,
          getRememberedProjectId: () => null,
          rememberProjectId: ignore,
          resetTopicLocalState: ignore,
          setHomePendingPreviewRequest: ignore,
          setTaskCenterDraftSendRequest: ignore,
          taskCenterHomeSurfaceActiveRef: home,
          topicById: emptyTopicMap,
          topics: emptyTopics,
          isAutoRestoringSession: false,
          isSessionHydrating: false,
          shouldHydrateEmptyMatchedInitialSession: false,
          shouldPauseInitialSessionNavigationForTaskCenterDraft: false,
          messagesLength: sessionId ? 1 : 0,
          threadItemsLength: sessionId ? 1 : 0,
          turnsLength: sessionId ? 1 : 0,
          newChatAt: undefined,
        });
        return (
          <output
            data-session-id={sessionId}
            data-editable={!current.composerDraftRestoring}
          />
        );
      }
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push({ root, host });
      await act(async () => root.render(<Surface />));
      expect(
        host.querySelector("output")?.getAttribute("data-session-id"),
      ).toBe(target.id);
      expect(host.querySelector("output")?.getAttribute("data-editable")).toBe(
        "true",
      );
      expect(current.composerDraftStatus?.scope).toEqual(target);
      expect(fixture.controller.getDocument().text).toBe(
        "unsent session draft",
      );
      expect(hydrate).toHaveBeenCalledTimes(1);
    },
  );
});
