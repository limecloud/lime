import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  accepted,
  deferred,
  installCoordinatorHarness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";
import type { useWorkspaceSendSurfaceRuntime } from "./useWorkspaceSendSurfaceRuntime";
import {
  useAgentChatWorkspaceCommandWiring,
  type AgentChatWorkspaceCommandScope,
} from "./useAgentChatWorkspaceCommandWiring";
import type { useWorkspaceTaskCenterNavigationRuntime } from "./useWorkspaceTaskCenterNavigationRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
vi.mock("../hooks/useTrayModelShortcuts", () => ({
  useTrayModelShortcuts: vi.fn(),
}));
vi.mock("./useWorkspaceCanvasMessageSyncRuntime", () => ({
  useWorkspaceCanvasMessageSyncRuntime: vi.fn(),
}));
vi.mock("./useWorkspacePersistenceRuntime", () => ({
  useWorkspacePersistenceRuntime: () => ({}),
}));
vi.mock("./useWorkspaceResetRuntime", () => ({
  useWorkspaceResetRuntime: () => ({}),
}));
vi.mock("./useWorkspaceSessionRestore", () => ({
  useWorkspaceSessionRestore: () => ({}),
}));
vi.mock("./useGeneralWorkbenchInitialDispatchRuntime", () => ({
  useGeneralWorkbenchInitialDispatchRuntime: () => ({}),
}));
vi.mock("./useWorkspaceTaskCenterDraftStateRuntime", () => ({
  useWorkspaceTaskCenterDraftStateRuntime: () => ({
    handleTopicSwitchCommitted: navigation.draftCommitted,
  }),
}));
vi.mock("./useWorkspaceSendSurfaceRuntime", () => ({
  useWorkspaceSendSurfaceRuntime: (options: unknown) => {
    navigation.send.capture(options);
    return {};
  },
}));
vi.mock("./useWorkspaceWorkbenchActionSurfaceRuntime", () => ({
  useWorkspaceWorkbenchActionSurfaceRuntime: () => ({}),
}));
const navigation = vi.hoisted(() => ({
  capture: vi.fn(),
  draftCommitted: vi.fn(),
  send: { capture: vi.fn() },
}));
vi.mock("./useWorkspaceTaskCenterNavigationRuntime", () => ({
  useWorkspaceTaskCenterNavigationRuntime: (options: unknown) => {
    navigation.capture(options);
    return {};
  },
}));
const setup = installCoordinatorHarness({ safeInvoke, safeListen });
const roots: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => {
  act(() => {
    for (const { root, host } of roots.splice(0)) {
      root.unmount();
      host.remove();
    }
  });
  vi.unstubAllGlobals();
});

describe("Command wiring keeps Composer scope in the visible workspace", () => {
  it("keeps a forked child editable after the initial parent route was hydrated", async () => {
    const fixture = await setup();
    const parent = { workspaceId: "w", kind: "local" as const, id: "parent" };
    const child = { ...parent, id: "child" };
    fixture.seed(parent, "parent unsent draft");
    let current!: ReturnType<typeof useAgentChatWorkspaceCommandWiring>;
    let select!: (id: string) => void;
    let route!: (id: string) => void;
    function Surface() {
      const [sessionId, setSessionId] = useState(parent.id);
      const [initialSessionId, setInitialSessionId] = useState(parent.id);
      select = setSessionId;
      route = setInitialSessionId;
      current = useAgentChatWorkspaceCommandWiring({
        scope: {
          composerController: fixture.controller,
          taskCenterWorkspaceId: "w",
          sessionId,
          normalizedInitialSessionId: initialSessionId,
          projectSelectionSource: "manual",
        } as AgentChatWorkspaceCommandScope,
        navigationProjectId: "w",
        trayActiveTheme: "general",
        consumePendingSkill: vi.fn(),
        pendingSkillKey: undefined,
        sceneGateResumeHandlerRef: { current: async () => false },
        composerDraftTitle: "Draft",
      });
      return (
        <output>{String(current.composerDraft.composerDraftRestoring)}</output>
      );
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push({ root, host });
    await act(async () => root.render(<Surface />));
    expect(current.composerDraft.composerDraftRestoring).toBe(false);
    const navigate = async (scope: typeof parent) => {
      const options = navigation.capture.mock.lastCall![0] as Parameters<
        typeof useWorkspaceTaskCenterNavigationRuntime
      >[0];
      const epoch = current.composerDraft.getComposerDraftNavigationEpoch();
      await act(async () => {
        select(scope.id);
        options.onAfterTopicSwitch?.(scope.id, scope.workspaceId, epoch);
      });
      expect(current.composerDraft.composerDraftStatus?.scope).toEqual(scope);
      expect(current.composerDraft.composerDraftRestoring).toBe(false);
    };
    await navigate(child);
    expect(fixture.controller.getDocument().text).toBe("");
    act(() => fixture.controller.setText("child unsent draft"));
    await navigate(parent);
    expect(fixture.controller.getDocument().text).toBe("parent unsent draft");
    await navigate(child);
    expect(fixture.controller.getDocument().text).toBe("child unsent draft");
    await act(async () => route("another-route"));
    expect(current.composerDraft.composerDraftRestoring).toBe(true);
    expect(fixture.controller.getDocument().text).toBe("child unsent draft");
    await act(async () => route(parent.id));
    expect(current.composerDraft.composerDraftRestoring).toBe(true);
  });

  async function mountSend(submit: () => Promise<RuntimeSubmissionResult>) {
    const fixture = await setup();
    const home = {
      workspaceId: "visible-workspace",
      kind: "home" as const,
      id: "new-conversation",
    };
    fixture.seed(home, "unsent Home draft");
    let current!: ReturnType<typeof useAgentChatWorkspaceCommandWiring>;
    const deferTopicSwitch = vi.fn();
    let setSession!: (id: string) => void;
    function Surface() {
      const [sessionId, updateSession] = useState<string | null>(null);
      setSession = updateSession;
      current = useAgentChatWorkspaceCommandWiring({
        scope: {
          composerController: fixture.controller,
          taskCenterWorkspaceId: home.workspaceId,
          sessionId,
          sendMessage: submit,
          deferTopicSwitch,
          normalizedInitialSessionId: null,
          projectSelectionSource: "prop",
        } as unknown as AgentChatWorkspaceCommandScope,
        navigationProjectId: "business-workspace",
        trayActiveTheme: "general",
        consumePendingSkill: vi.fn(),
        pendingSkillKey: undefined,
        sceneGateResumeHandlerRef: { current: async () => false },
        composerDraftTitle: "Draft",
      });
      return (
        <output>{String(current.composerDraft.composerDraftRestoring)}</output>
      );
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push({ root, host });
    await act(async () => root.render(<Surface />));
    const send = (
      navigation.send.capture.mock.lastCall![0] as Parameters<
        typeof useWorkspaceSendSurfaceRuntime
      >[0]
    ).sendActions.sendMessage;
    return {
      fixture,
      deferTopicSwitch,
      home,
      current: () => current,
      setSession: (id: string) => setSession(id),
      send,
    };
  }

  it("commits accepted Worktree navigation only after promoting the captured draft", async () => {
    const view = await mountSend(async () => accepted());
    navigation.draftCommitted.mockClear();
    const sendActions = (
      navigation.send.capture.mock.lastCall![0] as Parameters<
        typeof useWorkspaceSendSurfaceRuntime
      >[0]
    ).sendActions;
    const executionScope = {
      requestId: "r1",
      sourceWorkspaceId: view.home.workspaceId,
      sourceWorkingDir: "/source",
      workspaceId: "target-workspace",
      workingDir: "/target",
    };
    const result = accepted();
    if (result.kind !== "runtime-accepted")
      throw new Error("missing fixture acceptance");
    expect(sendActions.onExecutionScopeAccepted).toBeUndefined();
    const capture = view
      .current()
      .composerDraft.composerDraftCoordinator!.captureSubmission("start");
    const target = {
      workspaceId: executionScope.workspaceId,
      kind: "local",
      id: result.receipt.sessionId,
    };
    view.deferTopicSwitch.mockImplementation(() => {
      expect(view.current().composerDraft.getComposerDraftTarget()).toEqual(
        target,
      );
    });
    await act(async () =>
      view.current().composerDraft.handleComposerDraftAccepted(capture, {
        ...result,
        receipt: { ...result.receipt, executionScope },
      }),
    );
    expect(view.deferTopicSwitch).toHaveBeenCalledExactlyOnceWith(
      "s1",
      "target-workspace",
      { allowDetachedSession: true },
    );
    expect(view.current().composerDraft.getComposerDraftTarget()).toEqual(
      target,
    );
    expect(navigation.draftCommitted).toHaveBeenCalledExactlyOnceWith("s1");
  });

  it("does not navigate a late Worktree acceptance over a newer draft", async () => {
    const view = await mountSend(async () => accepted());
    const capture = view
      .current()
      .composerDraft.composerDraftCoordinator!.captureSubmission("start");
    const newer = {
      workspaceId: "newer-workspace",
      kind: "local" as const,
      id: "newer-session",
    };
    await act(async () =>
      view.current().composerDraft.commitComposerDraftScope(newer),
    );
    act(() => view.fixture.controller.setText("newer unsent edit"));
    const result = accepted();
    if (result.kind !== "runtime-accepted")
      throw new Error("missing fixture acceptance");
    await act(async () =>
      view.current().composerDraft.handleComposerDraftAccepted(capture, {
        ...result,
        receipt: {
          ...result.receipt,
          executionScope: {
            requestId: "late",
            sourceWorkspaceId: view.home.workspaceId,
            sourceWorkingDir: "/source",
            workspaceId: "target-workspace",
            workingDir: "/target",
          },
        },
      }),
    );
    expect(view.deferTopicSwitch).not.toHaveBeenCalled();
    expect(view.current().composerDraft.getComposerDraftTarget()).toEqual(
      newer,
    );
    expect(view.fixture.controller.getDocument().text).toBe(
      "newer unsent edit",
    );
  });

  it("binds a visible session accepted by an imperative initial send and preserves its Home draft", async () => {
    const view = await mountSend(async () => accepted());
    expect(view.fixture.controller.getDocument().text).toBe(
      "unsent Home draft",
    );
    await act(async () => {
      view.setSession("s1");
      expect(await view.send("external initial prompt", [])).toEqual(
        accepted(),
      );
    });
    expect(view.current().composerDraft.composerDraftStatus?.scope).toEqual({
      workspaceId: view.home.workspaceId,
      kind: "local",
      id: "s1",
    });
    expect(view.current().composerDraft.composerDraftRestoring).toBe(false);
    expect(view.fixture.controller.getDocument().text).toBe("");
    expect((await view.fixture.read(view.home))?.state).toBe("draft");
    expect(view.fixture.mutations.map((item) => item.op)).not.toContain(
      "consume",
    );
  });

  it("waits for the accepted session to become the actual visible target", async () => {
    const view = await mountSend(async () => accepted());
    await act(async () => {
      await view.send("initial prompt", []);
    });
    expect(view.current().composerDraft.composerDraftStatus?.scope).toEqual(
      view.home,
    );
    expect(view.fixture.controller.getDocument().text).toBe(
      "unsent Home draft",
    );
    await act(async () => view.setSession("s1"));
    expect(view.current().composerDraft.composerDraftStatus?.scope?.id).toBe(
      "s1",
    );
    expect(view.current().composerDraft.composerDraftRestoring).toBe(false);
  });

  it.each(["rejected", "unknown", "local-handled"] as const)(
    "does not commit a session from a %s result",
    async (kind) => {
      const view = await mountSend(async () => ({ kind }));
      await act(async () => {
        view.setSession("s1");
        expect(await view.send("initial prompt", [])).toEqual({ kind });
      });
      expect(view.current().composerDraft.composerDraftStatus?.scope).toEqual(
        view.home,
      );
      expect(view.current().composerDraft.composerDraftRestoring).toBe(true);
      expect(view.fixture.controller.getDocument().text).toBe(
        "unsent Home draft",
      );
    },
  );

  it("leaves Composer submission promotion to its existing captured identity owner", async () => {
    const view = await mountSend(async () => accepted());
    const capture = view
      .current()
      .composerDraft.composerDraftCoordinator!.captureSubmission("start");
    await act(async () => {
      view.setSession("s1");
      await view.send(
        "Composer prompt",
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          composerDraft: view.fixture.controller.captureDraft(),
        },
      );
    });
    expect(view.current().composerDraft.composerDraftStatus?.scope).toEqual(
      view.home,
    );
    const result = accepted();
    if (result.kind !== "runtime-accepted")
      throw new Error("missing fixture receipt");
    await act(async () =>
      view.current().composerDraft.handleComposerDraftAccepted(capture, result),
    );
    expect(view.current().composerDraft.composerDraftStatus?.scope?.id).toBe(
      "s1",
    );
    expect(view.current().composerDraft.composerDraftRestoring).toBe(false);
  });

  it("ignores an imperative acceptance after another navigation epoch commits", async () => {
    const pending = deferred<RuntimeSubmissionResult>();
    const view = await mountSend(() => pending.promise);
    const submitted = view.send("initial prompt", []);
    const newer = { ...view.home, kind: "local" as const, id: "newer-session" };
    await act(async () => {
      view.setSession(newer.id);
      view.current().composerDraft.commitComposerDraftScope(newer);
    });
    act(() => view.fixture.controller.setText("newer unsent edit"));
    await act(async () => {
      pending.resolve(accepted());
      expect(await submitted).toEqual(accepted());
    });
    expect(view.current().composerDraft.composerDraftStatus?.scope).toEqual(
      newer,
    );
    expect(view.current().composerDraft.composerDraftRestoring).toBe(false);
    expect(view.fixture.controller.getDocument().text).toBe(
      "newer unsent edit",
    );
  });

  it.each([
    { visible: "workspace-a", business: undefined, hydrated: null },
    {
      visible: null,
      business: "default-workspace",
      hydrated: "default-workspace",
    },
  ])(
    "commits the local editor when UI workspace=$visible and business workspace=$business",
    async ({ visible, business, hydrated }) => {
      const fixture = await setup();
      let current!: ReturnType<typeof useAgentChatWorkspaceCommandWiring>;
      let setSession!: (id: string) => void;
      function Surface() {
        const [sessionId, updateSession] = useState<string | null>(null);
        setSession = updateSession;
        current = useAgentChatWorkspaceCommandWiring({
          scope: {
            composerController: fixture.controller,
            taskCenterWorkspaceId: visible,
            sessionId,
            normalizedInitialSessionId: null,
            projectSelectionSource: "manual",
          } as AgentChatWorkspaceCommandScope,
          navigationProjectId: business,
          trayActiveTheme: "general",
          consumePendingSkill: vi.fn(),
          pendingSkillKey: undefined,
          sceneGateResumeHandlerRef: { current: async () => false },
          composerDraftTitle: "Draft",
        });
        return (
          <output>
            {current.composerDraft.composerDraftRestoring
              ? "restoring"
              : "ready"}
          </output>
        );
      }
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push({ root, host });
      await act(async () => root.render(<Surface />));
      expect(current.composerDraft.composerDraftRestoring).toBe(false);
      const options = navigation.capture.mock.lastCall![0] as Parameters<
        typeof useWorkspaceTaskCenterNavigationRuntime
      >[0];
      const epoch = current.composerDraft.getComposerDraftNavigationEpoch();
      await act(async () => {
        setSession("canonical-session");
        options.onAfterTopicSwitch?.("canonical-session", hydrated, epoch);
      });
      expect(current.composerDraft.composerDraftStatus?.scope).toEqual({
        workspaceId: visible,
        kind: "local",
        id: "canonical-session",
      });
      expect(current.composerDraft.composerDraftRestoring).toBe(false);
      expect(host.textContent).toBe("ready");
    },
  );
});
