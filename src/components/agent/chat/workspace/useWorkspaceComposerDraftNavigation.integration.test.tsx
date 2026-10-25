import { act, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  deferred,
  installCoordinatorHarness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";
import { LAST_PROJECT_ID_KEY } from "../hooks/agentProjectStorage";
import { useWorkspaceProjectSelection } from "../hooks/useWorkspaceProjectSelection";
import { useWorkspaceComposerDraftRuntime } from "./useWorkspaceComposerDraftRuntime";
import { useWorkspaceComposerDraftNavigation } from "./useWorkspaceComposerDraftNavigation";
import { useWorkspaceTaskCenterDraftStateRuntime } from "./useWorkspaceTaskCenterDraftStateRuntime";
import { useWorkspaceTopicSwitch } from "./useWorkspaceTopicSwitch";
import { useTaskCenterTopicNavigationRuntime } from "./useTaskCenterTopicNavigationRuntime";
import type { TaskCenterWorkspaceTabMap } from "../utils/taskCenterTabs";
import type { Topic } from "../hooks/agentChatShared";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const projectApi = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/api/project", () => projectApi);

const setup = installCoordinatorHarness({ safeInvoke, safeListen });
type StoreFixture = Awaited<ReturnType<typeof setup>>;
const mounted: Array<{ root: Root; element: HTMLDivElement }> = [];
const homeA: DraftScope = {
  workspaceId: "workspace-a",
  kind: "home",
  id: "new-conversation",
};
const homeB: DraftScope = { ...homeA, workspaceId: "workspace-b" };
const draftA: DraftScope = homeA;
const draftB: DraftScope = homeB;
const topicB: DraftScope = { ...homeB, kind: "local", id: "topic-b" };
const noop = () => undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem(LAST_PROJECT_ID_KEY, JSON.stringify(homeA.workspaceId));
  projectApi.getProject.mockImplementation(async (id: string) => ({
    id,
    isArchived: false,
  }));
});
afterEach(() => {
  act(() => {
    for (const { root, element } of mounted.splice(0)) {
      root.unmount();
      element.remove();
    }
  });
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount(
  fixture: StoreFixture,
  initialScope: DraftScope,
  originalSwitchTopic: Parameters<
    typeof useWorkspaceTopicSwitch
  >[0]["originalSwitchTopic"] = vi.fn(async (_topicId: string) => undefined),
  commitSessionSynchronously = false,
) {
  const clearTaskCenterEmbeddedHomeSession = vi.fn();
  let current!: {
    draft: ReturnType<typeof useWorkspaceComposerDraftRuntime>;
    selection: ReturnType<typeof useWorkspaceProjectSelection>;
    state: ReturnType<typeof useWorkspaceTaskCenterDraftStateRuntime>;
    navigation: ReturnType<typeof useWorkspaceComposerDraftNavigation>;
    topics: ReturnType<typeof useWorkspaceTopicSwitch>;
    topicNavigation: ReturnType<typeof useTaskCenterTopicNavigationRuntime>;
    setSessionId: (sessionId: string | null) => void;
  };
  function Surface() {
    const selection = useWorkspaceProjectSelection();
    const [sessionId, setSessionId] = useState<string | null>(null);
    const draft = useWorkspaceComposerDraftRuntime({
      controller: fixture.controller,
      initialScope,
    });
    const state = useWorkspaceTaskCenterDraftStateRuntime({
      agentEntry: "conversation",
      deferSessionRecentMetadataSyncForNavigation: noop,
      effectiveThreadItemCount: 0,
      hasInitialSessionTopic: false,
      messagesLength: 0,
      normalizedInitialSessionId: null,
      sessionId,
      composerDraftCoordinator: draft.composerDraftCoordinator,
    });
    const navigation = useWorkspaceComposerDraftNavigation({
      composerDraftRuntime: draft,
      workspaceId: selection.projectId ?? null,
      projectSelectionSource: selection.projectSelectionSource,
      normalizedInitialSessionId: null,
      sessionId,
      onTopicSwitchCommitted: state.handleTopicSwitchCommitted,
    });
    const topics = useWorkspaceTopicSwitch({
      ...selection,
      originalSwitchTopic: async (id, options) => {
        const result = options
          ? await originalSwitchTopic(id, options)
          : await originalSwitchTopic(id);
        if (commitSessionSynchronously) flushSync(() => setSessionId(id));
        return result;
      },
      onBeforeTopicSwitch: state.handleBeforeTopicSwitch,
      onAfterTopicSwitch: (...args) => {
        if (commitSessionSynchronously)
          flushSync(() => navigation.handleTopicSwitchCommitted(...args));
        else navigation.handleTopicSwitchCommitted(...args);
      },
      composerDraftCoordinator: draft.composerDraftCoordinator,
      getComposerDraftNavigationEpoch: draft.getComposerDraftNavigationEpoch,
      loadTopicBoundProjectId: () => homeB.workspaceId,
      resetTopicLocalState: noop,
    });
    const activeSessionIdRef = useRef(sessionId);
    activeSessionIdRef.current = sessionId;
    const openIds = useRef<string[]>([]);
    const [detachedTopicId, setDetachedTopicId] = useState<string | null>(null);
    const [transitionTopicId, setTransitionTopicId] = useState<string | null>(
      null,
    );
    const [, setLocalOverride] = useState<{
      sessionId: string;
      routeSessionId: string | null;
    } | null>(null);
    const [, setOpenMap] = useState<TaskCenterWorkspaceTabMap>({});
    const topic: Topic = {
      id: topicB.id,
      title: "B history",
      createdAt: new Date(),
      updatedAt: new Date(),
      workspaceId: homeB.workspaceId,
      workingDir: null,
      messagesCount: 1,
      executionStrategy: "react",
      status: "done",
      lastPreview: "B history",
      hasUnread: false,
      tag: null,
      sourceSessionId: topicB.id,
    };
    const topicNavigation = useTaskCenterTopicNavigationRuntime({
      activeSessionIdRef,
      agentEntry: "conversation",
      clearEntryPendingA2UI: noop,
      clearTaskCenterEmbeddedHomeSession,
      messagesLength: 0,
      replaceTaskCenterOpenTabs: noop,
      resetLocalImageWorkbenchSessionScope: noop,
      composerDraftCoordinator: draft.composerDraftCoordinator,
      getComposerDraftNavigationEpoch: draft.getComposerDraftNavigationEpoch,
      sessionId,
      setTaskCenterDetachedTopicId: setDetachedTopicId,
      setTaskCenterLocalSessionOverride: setLocalOverride,
      setTaskCenterOpenTabMap: setOpenMap,
      setTaskCenterTransitionTopicId: setTransitionTopicId,
      switchTopic: topics.switchTopic,
      taskCenterDetachedTopicId: detachedTopicId,
      taskCenterHomeSurfaceActiveRef: state.taskCenterHomeSurfaceActiveRef,
      taskCenterOpenTabIdsRef: openIds,
      taskCenterTransitionTopicId: transitionTopicId,
      taskCenterWorkspaceId: selection.projectId,
      topicById: new Map([[topic.id, topic]]),
      upsertTaskCenterOpenTab: noop,
      markTaskCenterLocalSessionOverride: noop,
    });
    current = {
      draft,
      selection,
      state,
      navigation,
      topics,
      topicNavigation,
      setSessionId,
    };
    return null;
  }
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mounted.push({ root, element });
  await act(async () => root.render(<Surface />));
  const activate = (_id: string) => {
    act(() => {
      current.state.taskCenterHomeSurfaceActiveRef.current = true;
    });
  };
  return {
    current: () => current,
    activate,
    originalSwitchTopic,
    clearTaskCenterEmbeddedHomeSession,
  };
}

describe("Workspace draft navigation with real scope and document owners", () => {
  it("resumes a cross-workspace topic switch without turning it into picker home navigation", async () => {
    const h = await setup();
    h.seed(topicB, "B topic draft");
    const view = await mount(h, draftA);
    view.activate(draftA.id);
    act(() => h.controller.setText("A unsent"));
    const generation = view.current().draft.composerDraftStatus?.generation;
    const epoch = view.current().draft.getComposerDraftNavigationEpoch();

    await act(async () => {
      expect(await view.current().topics.switchTopic(topicB.id)).toBe(
        "deferred",
      );
    });
    expect(view.originalSwitchTopic).toHaveBeenCalledExactlyOnceWith(topicB.id);
    expect(view.current().selection.projectSelectionSource).toBe(
      "topic-switch",
    );
    expect(view.current().selection.projectId).toBe(homeB.workspaceId);
    expect(view.current().draft.getComposerDraftNavigationEpoch()).toBe(epoch);
    expect(view.current().draft.composerDraftStatus?.generation).toBe(
      generation,
    );
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(draftA);
    expect(h.controller.getDocument().text).toBe("A unsent");

    await act(async () => view.current().setSessionId(topicB.id));
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(topicB);
    expect(view.current().state.taskCenterHomeSurfaceActiveRef.current).toBe(
      false,
    );
    expect(h.controller.getDocument().text).toBe("B topic draft");
    await act(async () =>
      view.current().draft.composerDraftCoordinator!.idle(),
    );
    expect((await h.read(draftA))?.state).toBe("draft");
  });

  it("same-workspace hydration can commit its canonical scope before the outer topic await resumes", async () => {
    localStorage.setItem(
      LAST_PROJECT_ID_KEY,
      JSON.stringify(homeB.workspaceId),
    );
    const h = await setup();
    h.seed(topicB, "canonical B draft");
    const view = await mount(
      h,
      homeB,
      vi.fn(async (_id: string) => undefined),
      true,
    );
    act(() => h.controller.setText("home B retained"));
    let result: unknown;
    await act(async () => {
      result = await view
        .current()
        .topicNavigation.handleOpenTaskTopic(topicB.id);
    });
    expect(result).toBe("success");
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(topicB);
    expect(h.controller.getDocument().text).toBe("canonical B draft");
    expect(view.current().state.taskCenterHomeSurfaceActiveRef.current).toBe(
      false,
    );
    expect(
      view.clearTaskCenterEmbeddedHomeSession,
    ).toHaveBeenCalledExactlyOnceWith(topicB.id);
  });

  it("waits for both the real session and workspace before clearing draft activation", async () => {
    const h = await setup();
    const view = await mount(h, draftA);
    view.activate(draftA.id);
    act(() => h.controller.setText("editable source"));
    const generation = view.current().draft.composerDraftStatus?.generation;
    await act(async () => {
      view
        .current()
        .navigation.handleTopicSwitchCommitted(
          topicB.id,
          homeB.workspaceId,
          view.current().draft.getComposerDraftNavigationEpoch(),
        );
    });
    await act(async () => view.current().setSessionId(topicB.id));
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(draftA);
    expect(view.current().draft.composerDraftStatus?.generation).toBe(
      generation,
    );
    expect(h.controller.getDocument().text).toBe("editable source");
  });

  it("a pending old topic cannot clear a newer draft when its session arrives late", async () => {
    const h = await setup();
    const newer: DraftScope = homeB;
    h.seed(newer, "new draft unsent");
    const view = await mount(h, draftA);
    view.activate(draftA.id);
    const capturedEpoch = view
      .current()
      .draft.getComposerDraftNavigationEpoch();
    await act(async () => {
      view
        .current()
        .navigation.handleTopicSwitchCommitted(
          "old-topic",
          homeA.workspaceId,
          capturedEpoch,
        );
    });
    await act(async () => {
      view.current().draft.commitComposerDraftScope(newer);
      view.current().state.taskCenterHomeSurfaceActiveRef.current = true;
    });
    await act(async () => view.current().setSessionId("old-topic"));
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(newer);
    expect(view.current().state.taskCenterHomeSurfaceActiveRef.current).toBe(
      true,
    );
    expect(h.controller.getDocument().text).toBe("new draft unsent");
    await act(async () => {
      view
        .current()
        .navigation.handleTopicSwitchCommitted(
          "old-topic",
          homeA.workspaceId,
          capturedEpoch,
        );
    });
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(newer);
  });

  it("the actual project picker saves A and restores the selected workspace home", async () => {
    const h = await setup();
    h.seed(homeB, "B home unsent");
    const view = await mount(h, homeA);
    act(() => h.controller.setText("A home unsent"));
    await act(async () =>
      view.current().selection.applyProjectSelection(homeB.workspaceId),
    );
    expect(view.current().selection.projectSelectionSource).toBe("manual");
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(homeB);
    expect(h.controller.getDocument().text).toBe("B home unsent");
    await act(async () =>
      view.current().draft.composerDraftCoordinator!.idle(),
    );
    expect((await h.read(homeA))?.state).toBe("draft");
    await act(async () =>
      view.current().selection.applyProjectSelection(homeA.workspaceId),
    );
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(homeA);
    expect(h.controller.getDocument().text).toBe("A home unsent");
  });

  it("a project selection and explicit draft target in the same event preserve activation", async () => {
    const h = await setup();
    h.seed(draftB, "explicit B draft");
    const view = await mount(h, draftA);
    act(() => h.controller.setText("A retained"));
    await act(async () => {
      view.current().selection.applyProjectSelection(homeB.workspaceId);
      view.current().draft.commitComposerDraftScope(draftB);
      view.current().state.taskCenterHomeSurfaceActiveRef.current = true;
    });
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(draftB);
    expect(view.current().draft.getComposerDraftNavigationEpoch()).toBe(1);
    expect(view.current().state.taskCenterHomeSurfaceActiveRef.current).toBe(
      true,
    );
    expect(h.controller.getDocument().text).toBe("explicit B draft");
    await act(async () =>
      view.current().draft.composerDraftCoordinator!.idle(),
    );
    expect((await h.read(draftA))?.state).toBe("draft");
  });

  it("navigation during deferred hydration preserves the new target and activation", async () => {
    const h = await setup();
    const newer: DraftScope = homeB;
    h.seed(newer, "B remains editable");
    const gate = deferred<undefined>();
    const original = vi.fn(() => gate.promise);
    const view = await mount(h, draftA, original);
    view.activate(draftA.id);
    await act(async () => {
      expect(await view.current().topics.switchTopic(topicB.id)).toBe(
        "deferred",
      );
    });
    expect(original).toHaveBeenCalledExactlyOnceWith(topicB.id);
    await act(async () => {
      view.current().draft.commitComposerDraftScope(newer);
      view.current().state.taskCenterHomeSurfaceActiveRef.current = true;
    });
    await act(async () => {
      view.current().setSessionId(topicB.id);
      gate.resolve(undefined);
      await gate.promise;
    });
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(newer);
    expect(h.controller.getDocument().text).toBe("B remains editable");
  });
});
