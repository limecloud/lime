import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { decodeComposerDraft } from "@/components/input-kit/composerDraftCodec";
import {
  a as coordinatorA,
  b as coordinatorB,
  deferred,
  harness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import type { TaskCenterWorkspaceTabMap } from "../utils/taskCenterTabs";
import { useWorkspaceTopicSwitch } from "./useWorkspaceTopicSwitch";
import { useWorkspaceTaskCenterDraftStateRuntime } from "./useWorkspaceTaskCenterDraftStateRuntime";
import { useTaskCenterTopicNavigationRuntime } from "./useTaskCenterTopicNavigationRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
const projects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/api/project", () => projects);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const a = { ...coordinatorA, kind: "home" as const, id: "new-conversation" };
const b = { ...coordinatorB, kind: "local" as const, id: "other-session" };

let active: Awaited<ReturnType<typeof harness>> | null = null;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function mount<P extends object, V>(useHook: (props: P) => V, props: P) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let value!: V;
  function Probe(next: P) {
    value = useHook(next);
    return null;
  }
  mounted.push({ root, container });
  const render = (next: P) => act(() => root.render(<Probe {...next} />));
  render(props);
  return { get: () => value, render };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  await active?.close();
  active = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  active = await harness({ safeInvoke, safeListen });
  await active.coordinator.bindCommitted(a);
  active.controller.setText("保留旧草稿😀");
  return active;
}
function switchProps(
  overrides: Partial<Parameters<typeof useWorkspaceTopicSwitch>[0]> = {},
) {
  return {
    projectId: "w",
    originalSwitchTopic: vi.fn(async () => undefined),
    onBeforeTopicSwitch: vi.fn(),
    onAfterTopicSwitch: vi.fn(),
    composerDraftCoordinator: active!.coordinator,
    startTopicProjectResolution: vi.fn(() => true),
    finishTopicProjectResolution: vi.fn(),
    deferTopicSwitch: vi.fn(),
    consumePendingTopicSwitch: vi.fn(() => null),
    rememberProjectId: vi.fn(),
    getRememberedProjectId: vi.fn(() => null),
    loadTopicBoundProjectId: vi.fn(() => "w"),
    resetTopicLocalState: vi.fn(),
    ...overrides,
  };
}

describe("navigation commits through real Controller, gateway, parser and Store", () => {
  it.each(["error", "blocked", "busy", "deferred", "missing"])(
    "original %s cannot reset or commit a new composer scope",
    async (outcome) => {
      const h = await setup();
      const before = h.coordinator.captureBinding()!;
      const props = switchProps({
        originalSwitchTopic: vi.fn(async () => outcome),
      });
      const hook = mount(useWorkspaceTopicSwitch, props);
      await act(async () => {
        expect(await hook.get().switchTopic("next")).toBe(outcome);
      });
      await h.coordinator.idle();
      expect(props.resetTopicLocalState).not.toHaveBeenCalled();
      expect(props.onAfterTopicSwitch).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
      expect(h.coordinator.captureBinding()?.identity).toEqual(before.identity);
      const entry = await h.read(a);
      expect(entry?.state).toBe("draft");
      if (entry?.state !== "draft") throw new Error("missing source");
      expect(decodeComposerDraft(entry.draft).document.text).toBe(
        "保留旧草稿😀",
      );
    },
  );

  it.each(["busy", "blocked", "missing"])(
    "resolution %s preserves editing scope",
    async (outcome) => {
      const h = await setup();
      const props = switchProps(
        outcome === "busy"
          ? { startTopicProjectResolution: vi.fn(() => false) }
          : outcome === "blocked"
            ? {
                projectId: "locked",
                externalProjectId: "locked",
                loadTopicBoundProjectId: () => "other",
              }
            : { projectId: undefined, loadTopicBoundProjectId: () => null },
      );
      const hook = mount(useWorkspaceTopicSwitch, props);
      await act(async () => {
        expect(await hook.get().switchTopic("next")).toBe(outcome);
      });
      await h.coordinator.idle();
      expect(props.originalSwitchTopic).not.toHaveBeenCalled();
      expect(props.onAfterTopicSwitch).not.toHaveBeenCalled();
      expect(h.coordinator.getSnapshot().scope).toEqual(a);
      expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
      expect((await h.read(a))?.state).toBe("draft");
    },
  );

  it("deferred project resume commits once with captured actual project", async () => {
    const h = await setup();
    projects.getProject.mockResolvedValue({ id: "other", isArchived: false });
    const props = switchProps({ loadTopicBoundProjectId: () => "other" });
    const hook = mount(useWorkspaceTopicSwitch, props);
    await act(async () => {
      expect(await hook.get().switchTopic("next")).toBe("deferred");
    });
    expect(props.onAfterTopicSwitch).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
    const consume =
      vi.fn<
        Parameters<
          typeof useWorkspaceTopicSwitch
        >[0]["consumePendingTopicSwitch"]
      >();
    consume
      .mockReturnValueOnce({ topicId: "next", targetProjectId: "other" })
      .mockReturnValue(null);
    await act(async () =>
      hook.render({
        ...props,
        projectId: "other",
        consumePendingTopicSwitch: consume,
      }),
    );
    expect(props.onAfterTopicSwitch).toHaveBeenCalledExactlyOnceWith(
      "next",
      "other",
    );
    expect(props.resetTopicLocalState).toHaveBeenCalledOnce();
    expect(h.coordinator.getSnapshot().scope).toEqual(a);
  });

  it("deferred topic cannot replace a later committed draft generation", async () => {
    const h = await setup();
    projects.getProject.mockResolvedValue({ id: "other", isArchived: false });
    const props = switchProps({ loadTopicBoundProjectId: () => "other" });
    const hook = mount(useWorkspaceTopicSwitch, props);
    await act(async () => {
      expect(await hook.get().switchTopic("next")).toBe("deferred");
    });
    await h.coordinator.bindCommitted(b);
    h.controller.setText("新草稿");
    const consume =
      vi.fn<
        Parameters<
          typeof useWorkspaceTopicSwitch
        >[0]["consumePendingTopicSwitch"]
      >();
    consume
      .mockReturnValueOnce({ topicId: "next", targetProjectId: "other" })
      .mockReturnValue(null);
    await act(async () =>
      hook.render({
        ...props,
        projectId: "other",
        consumePendingTopicSwitch: consume,
      }),
    );
    expect(props.originalSwitchTopic).not.toHaveBeenCalled();
    expect(props.onAfterTopicSwitch).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().document.text).toBe("新草稿");
    expect(h.coordinator.getSnapshot().scope).toEqual(b);
  });

  it.each(["scope-promotion", "ui-epoch"])(
    "deferred %s invalidation cancels resume without recapturing the source",
    async (invalidation) => {
      const h = await setup();
      let navigationEpoch = 1;
      projects.getProject.mockResolvedValue({ id: "other", isArchived: false });
      const props = switchProps({
        loadTopicBoundProjectId: () => "other",
        getComposerDraftNavigationEpoch: () => navigationEpoch,
      });
      const hook = mount(useWorkspaceTopicSwitch, props);
      await act(async () => {
        expect(await hook.get().switchTopic("next")).toBe("deferred");
      });
      const generation = h.coordinator.getSnapshot().generation;
      if (invalidation === "scope-promotion") {
        const token = h.coordinator.captureBinding()!;
        await h.coordinator.promote(
          token,
          { workspaceId: null, kind: "local", id: "actual" },
          { expectedTarget: null, sessionId: "actual" },
        );
        expect(h.coordinator.getSnapshot().generation).toBe(generation);
      } else {
        navigationEpoch += 1;
      }
      const consume =
        vi.fn<
          Parameters<
            typeof useWorkspaceTopicSwitch
          >[0]["consumePendingTopicSwitch"]
        >();
      consume
        .mockReturnValueOnce({ topicId: "next", targetProjectId: "other" })
        .mockReturnValue(null);
      await act(async () =>
        hook.render({
          ...props,
          projectId: "other",
          consumePendingTopicSwitch: consume,
        }),
      );
      expect(props.originalSwitchTopic).not.toHaveBeenCalled();
      expect(props.onAfterTopicSwitch).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
    },
  );

  it("superseded completion cannot commit after a newer success", async () => {
    await setup();
    const first = deferred<undefined>();
    const second = deferred<undefined>();
    const props = switchProps({
      originalSwitchTopic: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const hook = mount(useWorkspaceTopicSwitch, props);
    let firstResult!: Promise<unknown>;
    let secondResult!: Promise<unknown>;
    act(() => {
      firstResult = hook.get().runTopicSwitch("old");
      secondResult = hook.get().runTopicSwitch("new");
    });
    await act(async () => {
      second.resolve(undefined);
      await secondResult;
    });
    await act(async () => {
      first.resolve(undefined);
      expect(await firstResult).toBe("superseded");
    });
    expect(props.onAfterTopicSwitch).toHaveBeenCalledExactlyOnceWith(
      "new",
      "w",
    );
    expect(props.resetTopicLocalState).toHaveBeenCalledOnce();
  });

  it("draft activation and Controller survive preparation until actual topic commit", async () => {
    const h = await setup();
    const hook = mount(useWorkspaceTaskCenterDraftStateRuntime, {
      agentEntry: "conversation",
      composerDraftCoordinator: h.coordinator,
      resetComposerDraft: vi.fn(),
      deferSessionRecentMetadataSyncForNavigation: vi.fn(),
      effectiveThreadItemCount: 0,
      hasInitialSessionTopic: true,
      messagesLength: 0,
      normalizedInitialSessionId: "old",
      sessionId: "old",
    });
    act(() => {
      hook.get().taskCenterHomeSurfaceActiveRef.current = true;
    });
    act(() => hook.get().handleBeforeTopicSwitch("new"));
    expect(hook.get().taskCenterHomeSurfaceActiveRef.current).toBe(true);
    act(() => hook.get().handleTopicSwitchCommitted("new"));
    expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
    expect(h.coordinator.getSnapshot().scope).toEqual(a);
  });
});

function useNavigationHarness(props: {
  switchTopic: Parameters<
    typeof useTaskCenterTopicNavigationRuntime
  >[0]["switchTopic"];
  openTopics?: string[];
  workspaceId?: string | null;
  getNavigationEpoch?: () => number;
}) {
  const [, setDetached] = useState<string | null>(null);
  const [, setOverride] = useState<{
    sessionId: string;
    routeSessionId: string | null;
  } | null>(null);
  const [, setMap] = useState<TaskCenterWorkspaceTabMap>({});
  const [, setTransition] = useState<string | null>(null);
  const surface = useRef(true);
  const runtime = useTaskCenterTopicNavigationRuntime({
    activeSessionIdRef: useRef("old"),
    agentEntry: "conversation",
    clearEntryPendingA2UI: vi.fn(),
    clearTaskCenterEmbeddedHomeSession: vi.fn(),
    messagesLength: 0,
    replaceTaskCenterOpenTabs: vi.fn(),
    resetLocalImageWorkbenchSessionScope: vi.fn(),
    composerDraftCoordinator: active!.coordinator,
    getComposerDraftNavigationEpoch: props.getNavigationEpoch,
    sessionId: "old",
    setTaskCenterDetachedTopicId: setDetached,
    setTaskCenterLocalSessionOverride: setOverride,
    setTaskCenterOpenTabMap: setMap,
    setTaskCenterTransitionTopicId: setTransition,
    switchTopic: props.switchTopic,
    taskCenterDetachedTopicId: null,
    taskCenterHomeSurfaceActiveRef: surface,
    taskCenterOpenTabIdsRef: useRef(props.openTopics ?? []),
    taskCenterTransitionTopicId: null,
    taskCenterWorkspaceId:
      props.workspaceId === undefined ? "w" : props.workspaceId,
    topicById: new Map(),
    upsertTaskCenterOpenTab: vi.fn(),
    markTaskCenterLocalSessionOverride: vi.fn(),
  });
  return { ...runtime, surface };
}

describe("topic navigation only changes the editing target after commit", () => {
  it.each(["blocked", "deferred", "error"])(
    "%s retains active draft and editable document",
    async (outcome) => {
      const h = await setup();
      const hook = mount(useNavigationHarness, {
        switchTopic: vi.fn(async () => outcome),
      });
      await act(async () => {
        await hook.get().handleOpenTaskTopic("next");
      });
      expect(hook.get().surface.current).toBe(true);
      expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
    },
  );

  it("busy retry success finally clears activation without clearing Controller", async () => {
    const h = await setup();
    const switching = vi
      .fn()
      .mockResolvedValueOnce("busy")
      .mockResolvedValueOnce("success");
    const hook = mount(useNavigationHarness, { switchTopic: switching });
    await act(async () => {
      await hook.get().handleOpenTaskTopic("next");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(hook.get().surface.current).toBe(false);
    expect(h.controller.getSnapshot().document.text).toBe("保留旧草稿😀");
  });

  it("busy retry cancels for a newer intended navigation before layout binding", async () => {
    await setup();
    let epoch = 1;
    const switching = vi.fn(async () => "busy");
    const hook = mount(useNavigationHarness, {
      switchTopic: switching,
      getNavigationEpoch: () => epoch,
    });
    await act(async () => {
      await hook.get().handleOpenTaskTopic("next");
    });
    epoch += 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(switching).toHaveBeenCalledOnce();
  });
});
