import { StrictMode, act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { encodeComposerDraft } from "@/components/input-kit/composerDraftCodec";
import {
  accepted,
  deferred,
  installCoordinatorHarness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import type { AgentPageParams } from "@/types/page";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";
import type { NewConversationRequest } from "@/lib/workspace/navigation";
import { useWorkspaceComposerDraftRuntime } from "./useWorkspaceComposerDraftRuntime";
import { useWorkspaceComposerDraftNavigation } from "./useWorkspaceComposerDraftNavigation";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
const setup = installCoordinatorHarness({ safeInvoke, safeListen });
type Fixture = Awaited<ReturnType<typeof setup>>;
const home: DraftScope = {
  workspaceId: null,
  kind: "home",
  id: "new-conversation",
};
const local: DraftScope = { workspaceId: null, kind: "local", id: "existing" };
const roots: Array<{ root: Root; element: HTMLDivElement }> = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
});
afterEach(() => {
  act(() => {
    for (const { root, element } of roots.splice(0)) {
      root.unmount();
      element.remove();
    }
  });
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
async function mount(
  h: Fixture,
  initialScope: DraftScope = home,
  strict = false,
) {
  let current!: {
    navigation: ReturnType<typeof useAppNavigation>;
    draft: ReturnType<typeof useWorkspaceComposerDraftRuntime>;
    setSession: (id: string | null) => void;
    setCommit: (enabled: boolean) => void;
    setWorkspace: (id: string | null | undefined) => void;
  };
  const onSurfaceCommit = vi.fn();
  function Surface() {
    const navigation = useAppNavigation();
    const route = navigation.pageParams as AgentPageParams;
    const [committed, setCommit] = useState(true);
    const [session, setSession] = useState<string | null>(null);
    const [workspaceOverride, setWorkspace] = useState<
      string | null | undefined
    >(undefined);
    const workspaceId =
      workspaceOverride === undefined
        ? (route.projectId ?? null)
        : workspaceOverride;
    const draft = useWorkspaceComposerDraftRuntime({
      controller: h.controller,
      initialScope,
    });
    const request =
      navigation.currentPage === "agent" && committed
        ? route.newConversationRequest
        : undefined;
    useWorkspaceComposerDraftNavigation({
      composerDraftRuntime: draft,
      newConversationRequest: request,
      workspaceId,
      projectSelectionSource:
        workspaceOverride === undefined ? "manual" : "topic-switch",
      normalizedInitialSessionId: route.initialSessionId ?? null,
      sessionId: session,
      onTopicSwitchCommitted: onSurfaceCommit,
    });
    const { commitComposerDraftScope } = draft;
    // Harness supplies a resolved canonical route, the same condition used by product navigation.
    useLayoutEffect(() => {
      if (route.initialSessionId && workspaceId === (route.projectId ?? null))
        commitComposerDraftScope({
          workspaceId,
          kind: "local",
          id: route.initialSessionId,
        });
    }, [
      commitComposerDraftScope,
      route.initialSessionId,
      route.projectId,
      workspaceId,
    ]);
    current = { navigation, draft, setSession, setCommit, setWorkspace };
    return (
      <>
        <button
          onClick={() =>
            navigation.startNewConversation({
              projectId: workspaceId,
              freshDraft: false,
            })
          }
        >
          Home
        </button>
        <button
          onClick={() =>
            navigation.startNewConversation({
              projectId: null,
              freshDraft: true,
            })
          }
        >
          New chat
        </button>
        <div data-composer-editor-host="true">
          <div role="textbox" tabIndex={0} />
        </div>
      </>
    );
  }
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  roots.push({ root, element });
  const render = async () => {
    await act(async () =>
      root.render(
        strict ? (
          <StrictMode>
            <Surface />
          </StrictMode>
        ) : (
          <Surface />
        ),
      ),
    );
  };
  await render();
  return {
    current: () => current,
    onSurfaceCommit,
    render,
    async request(request: { projectId: string | null; freshDraft: boolean }) {
      await act(async () => current.navigation.startNewConversation(request));
    },
    async click(label: string) {
      const button = [...element.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      )!;
      await act(async () => button.click());
    },
  };
}
function rich() {
  const source = new ComposerController({ text: "保留 rich 😀" });
  source.ingestPaste("折叠内容".repeat(300));
  source.setAttachments([{ data: "durable", mediaType: "image/png" }]);
  source.setPathReferences([
    { id: "file", path: "/tmp/a.ts", name: "a.ts", isDir: false },
  ]);
  return source.captureDraft();
}
function seedRich(h: Fixture, scope: DraftScope) {
  const value = rich();
  h.store.updatePersistedAtomState({
    op: "put",
    scope,
    draftId: "rich-home",
    nextVersion: "v1",
    expectedVersion: null,
    draft: encodeComposerDraft(value, false),
  });
  return value;
}

describe("public action -> committed route -> sole draft owner -> real gateway/parser/Store", () => {
  it("Home restores full existing home draft and repeated Home preserves identity/revision", async () => {
    const h = await setup(),
      saved = seedRich(h, home);
    h.seed(local, "local unsent");
    const view = await mount(h, local);
    act(() => {
      h.controller.setText("new local source 😀 ");
      h.controller.ingestPaste("local hidden content".repeat(120));
    });
    const source = h.controller.captureDraft();
    await view.click("Home");
    expect(h.controller.captureDraft()).toEqual(saved);
    const identity = view.current().draft.composerDraftStatus?.identity,
      revision = h.controller.getSnapshot().revision;
    await view.click("Home");
    expect(h.controller.captureDraft()).toEqual(saved);
    expect(view.current().draft.composerDraftStatus?.identity).toEqual(
      identity,
    );
    expect(h.controller.getSnapshot().revision).toBe(revision);
    expect(h.mutations.some((item) => item.op === "clear")).toBe(false);
    expect(await h.read(local)).toMatchObject({
      state: "draft",
      draft: encodeComposerDraft(source, false),
    });
    await act(async () =>
      view.current().navigation.handleNavigate("agent", {
        agentEntry: "conversation",
        initialSessionId: local.id,
      }),
    );
    expect(h.controller.captureDraft()).toEqual(source);
  });
  it("New chat retires the same-scope identity once, then the next edit gets a new identity", async () => {
    const h = await setup();
    seedRich(h, home);
    const view = await mount(h, home, true);
    const identity = view.current().draft.composerDraftStatus?.identity,
      generation = view.current().draft.composerDraftStatus?.generation,
      epoch = view.current().draft.getComposerDraftNavigationEpoch();
    await view.click("New chat");
    expect(h.controller.getDocument().text).toBe("");
    expect(h.controller.captureDraft().attachments).toEqual([]);
    expect(view.current().draft.composerDraftStatus?.identity).toBeNull();
    expect(
      view.current().draft.composerDraftStatus?.generation,
    ).toBeGreaterThan(generation!);
    expect(view.current().draft.getComposerDraftNavigationEpoch()).toBe(
      epoch + 1,
    );
    await view.render();
    expect(h.mutations.filter((item) => item.op === "clear")).toHaveLength(1);
    act(() => h.controller.setText("new valid edit"));
    await act(async () =>
      view.current().draft.composerDraftCoordinator!.idle(),
    );
    expect(
      view.current().draft.composerDraftStatus?.identity?.draftId,
    ).not.toBe(identity!.draftId);
    expect(document.activeElement?.getAttribute("role")).toBe("textbox");
  });
  it("a withheld route intent keeps the local source until the actual commit arrives", async () => {
    const h = await setup();
    h.seed(local, "source intact");
    const view = await mount(h, local);
    await act(async () => view.current().setCommit(false));
    await view.click("New chat");
    expect(h.controller.getDocument().text).toBe("source intact");
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(local);
    await act(async () => view.current().setCommit(true));
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(home);
    expect(h.controller.getDocument().text).toBe("");
    expect((await h.read(local))?.state).toBe("draft");
  });
  it("explicit null never inherits the previous project; another project commits its own home", async () => {
    const h = await setup();
    const projectHome = { ...home, workspaceId: "project-a" };
    h.seed(projectHome, "A unsent");
    seedRich(h, home);
    const view = await mount(h, projectHome);
    await view.request({ projectId: null, freshDraft: false });
    expect(
      (view.current().navigation.pageParams as AgentPageParams).projectId,
    ).toBeUndefined();
    expect(
      (view.current().navigation.pageParams as AgentPageParams)
        .newConversationRequest?.workspaceId,
    ).toBeNull();
    expect(h.controller.captureDraft()).toEqual(rich());
    const target = { ...home, workspaceId: "project-b" };
    h.store.updatePersistedAtomState({
      op: "put",
      scope: target,
      draftId: "unique-project-b",
      nextVersion: "b1",
      expectedVersion: null,
      draft: encodeComposerDraft(
        new ComposerController({ text: "B unsent" }).captureDraft(),
        false,
      ),
    });
    await view.request({ projectId: "project-b", freshDraft: false });
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(target);
    expect(h.controller.getDocument().text).toBe("B unsent");
    expect((await h.read(projectHome))?.state).toBe("draft");
  });
  it("an unresolved workspace cannot clear its old document", async () => {
    const h = await setup();
    h.seed(home, "original");
    const view = await mount(h);
    await act(async () => view.current().setWorkspace("previous-project"));
    await view.click("New chat");
    expect(h.controller.getDocument().text).toBe("original");
    await act(async () => view.current().setWorkspace(undefined));
    expect(h.controller.getDocument().text).toBe("");
  });
  it("same-millisecond New requests have distinct IDs and each is consumed only once", async () => {
    const h = await setup();
    h.seed(home, "first");
    const view = await mount(h);
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    await view.click("New chat");
    const first = (view.current().navigation.pageParams as AgentPageParams)
      .newConversationRequest!;
    act(() => h.controller.setText("second draft"));
    await view.click("New chat");
    const second = (view.current().navigation.pageParams as AgentPageParams)
      .newConversationRequest!;
    expect(second.id).toBe(first.id + 1);
    expect(h.controller.getDocument().text).toBe("");
    expect(h.mutations.filter((item) => item.op === "clear")).toHaveLength(2);
    now.mockRestore();
  });
  it("a committed request never replays after accepted local activation or callback changes", async () => {
    const h = await setup();
    const view = await mount(h);
    await view.click("New chat");
    act(() => h.controller.setText("submitted"));
    const capture = view
      .current()
      .draft.composerDraftCoordinator!.captureSubmission("start");
    const result = accepted();
    if (result.kind !== "runtime-accepted") throw new Error("fixture");
    const calls = view.onSurfaceCommit.mock.calls.length;
    await act(async () => {
      await view.current().draft.handleComposerDraftAccepted(capture, result);
      view.current().setSession(result.receipt.sessionId);
    });
    expect(view.onSurfaceCommit).toHaveBeenCalledTimes(calls);
    expect(view.current().draft.composerDraftStatus?.scope?.kind).toBe("local");
    expect(h.mutations.filter((item) => item.op === "clear")).toHaveLength(0);
  });
  it("failed fresh CAS keeps the full rich source and identity", async () => {
    const h = await setup(),
      saved = seedRich(h, home);
    const view = await mount(h);
    const identity = view.current().draft.composerDraftStatus?.identity;
    h.intercept((command, args, execute) =>
      command === "persisted_atom_update" &&
      (args.mutation as { op?: string }).op === "clear"
        ? Promise.reject(new Error("transport unavailable"))
        : execute(),
    );
    await view.click("New chat");
    expect(h.controller.captureDraft()).toEqual(saved);
    expect(view.current().draft.composerDraftStatus?.identity).toEqual(
      identity,
    );
    expect((await h.read(home))?.state).toBe("draft");
  });
  it("late fresh CAS cannot erase edits made while transport is in flight", async () => {
    const h = await setup();
    h.seed(home, "old");
    const view = await mount(h);
    const gate = deferred<undefined>();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.intercept((command, args, execute) => {
      if (
        command === "persisted_atom_update" &&
        (args.mutation as { op?: string }).op === "clear"
      ) {
        entered();
        return gate.promise.then(execute);
      }
      return execute();
    });
    await view.click("New chat");
    await started;
    act(() => h.controller.setText("newer wins"));
    await act(async () => {
      gate.resolve(undefined);
      await gate.promise;
      await view.current().draft.composerDraftCoordinator!.idle();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await view.current().draft.composerDraftCoordinator!.idle();
    });
    expect(h.controller.getDocument().text).toBe("newer wins");
    expect(await h.read(home)).toMatchObject({
      state: "draft",
      draft: { document: { text: "newer wins" } },
    });
  });
  it("acceptance captured before fresh cannot reclaim the new home epoch", async () => {
    const h = await setup();
    const view = await mount(h);
    act(() => h.controller.setText("old send"));
    const owner = view.current().draft.composerDraftCoordinator!;
    const capture = owner.captureSubmission("start");
    await act(async () => owner.idle());
    await view.click("New chat");
    act(() => h.controller.setText("new draft"));
    const result = accepted();
    if (result.kind !== "runtime-accepted") throw new Error("fixture");
    await act(async () => {
      await view.current().draft.handleComposerDraftAccepted(capture, result);
      await owner.settleSubmission(capture, result);
      await owner.idle();
    });
    expect(view.current().draft.composerDraftStatus?.scope).toEqual(home);
    expect(h.controller.getDocument().text).toBe("new draft");
    expect(await h.read(home)).toMatchObject({
      state: "draft",
      draft: { document: { text: "new draft" } },
    });
  });
  it("reload restores canonical navigation without replaying a fresh intent", async () => {
    const h = await setup();
    const view = await mount(h);
    const request: NewConversationRequest = {
      id: 1,
      workspaceId: null,
      freshDraft: true,
    };
    await act(async () =>
      view.current().navigation.handleNavigate("agent", {
        agentEntry: "conversation",
        initialSessionId: "existing",
        newConversationRequest: request,
      }),
    );
    const persisted = JSON.parse(
      sessionStorage.getItem("lime.appNavigation.restore.v1")!,
    );
    expect(persisted.params.initialSessionId).toBe("existing");
    expect(persisted.params.newConversationRequest).toBeUndefined();
  });
});
