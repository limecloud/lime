import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  harness,
  a,
  b,
  deferred,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import { useComposerController } from "@/components/input-kit/useComposerController";
import { useInputbarController } from "@/components/agent/chat/components/Inputbar/hooks/useInputbarController";
import {
  getInputbarSendOptions,
  type InputbarSendPayload,
} from "@/components/agent/chat/components/Inputbar/inputbarSendPayload";
import { canRestoreComposerSubmission } from "@/components/agent/chat/components/composerSubmissionSettlement";
import { insertComposerSkill } from "@/components/agent/chat/skill-selection/composerCapabilityMention";
import { resolveInputCapabilitySendRoute } from "@/components/agent/chat/skill-selection/inputCapabilitySelection";
import { prepareAgentStreamUserInputSend } from "@/components/agent/chat/hooks/agentStreamUserInputSendPreparation";
import { submitAgentStreamUserInput } from "@/components/agent/chat/hooks/agentStreamUserInputSubmission";
import { stopActiveAgentStream } from "@/components/agent/chat/hooks/agentStreamFlowControl";
import { createRestoreTokenFixture } from "@/components/agent/chat/hooks/agentStreamRestoreToken.testFixtures";
import type { InterruptedInputRestoreRequest } from "@/components/agent/chat/hooks/agentStreamInputRestoreTypes";
import type { Skill } from "@/lib/api/skills";
import { fromRuntimeAcceptanceReceipt } from "@/components/agent/chat/hooks/agentSendResult";
import { EmptyState } from "@/components/agent/chat/components/EmptyState";
import { useWorkspaceComposerDraftRuntime } from "@/components/agent/chat/workspace/useWorkspaceComposerDraftRuntime";
import type { ComposerDraftCoordinator } from "@/components/input-kit/ComposerDraftCoordinator";
import type { ComposerDraftCapture } from "@/components/input-kit/ComposerDraftCoordinator";
import type { AcceptedRuntimeSubmissionResult } from "@/components/agent/chat/hooks/agentSendResult";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";

const homePanel = vi.hoisted(() => ({
  send: undefined as (() => Promise<unknown>) | undefined,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/api/promptHistory", () => ({
  readPromptHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api/hintRoutes", () => ({
  listHintRoutes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-CN" },
  }),
}));
vi.mock("@/lib/api/permissionProfiles", () => ({
  resolveAllowedPermissionProfile: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: vi.fn(async () => [
      {
        id: "fixture",
        provider_id: "openai",
        capabilities: { vision: true, reasoning: false },
        task_families: ["chat", "vision_understanding"],
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        runtime_features: ["streaming"],
        capability_provenance: "provider_explicit",
      },
    ]),
  },
}));

vi.mock("@/lib/api/appConfig", () => ({ getConfig: vi.fn(async () => ({})) }));
vi.mock("@/components/agent/chat/components/EmptyStateLayout", () => ({
  EmptyStateComposerFrame: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  EmptyStateLayout: ({ composer }: { composer: React.ReactNode }) => (
    <>{composer}</>
  ),
}));
vi.mock("@/components/agent/chat/components/EmptyStateComposerPanel", () => ({
  // Only presentation is stubbed; EmptyState owns send/Stop/settlement/restore.
  EmptyStateComposerPanel: ({
    onSend,
    onStop,
  }: {
    onSend: () => Promise<unknown>;
    onStop: () => void;
  }) => {
    homePanel.send = onSend;
    return (
      <button data-testid="stop" onClick={onStop}>
        Stop
      </button>
    );
  },
}));

type PersistenceHarness = Awaited<ReturnType<typeof harness>>;
const mounted: { root: Root; element: HTMLElement; h: PersistenceHarness }[] =
  [];
const skill: Skill = {
  key: "user:capability-report",
  name: "Capability Report",
  description: "Report",
  directory: "/tmp/capability-report",
  installed: true,
  sourceKind: "other",
};
const skills = [skill];
const noop = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.element.remove();
    await item.h.close();
  }
  vi.useRealTimers();
});

async function setup({
  persistent = true,
  delayedConsume = false,
  home = false,
  runtimeScope = null as DraftScope | null,
  initialSkills = skills,
} = {}) {
  let catalog = initialSkills;
  const h = await harness({ safeInvoke, safeListen });
  if (runtimeScope) h.coordinator.detach();
  else if (persistent) await h.coordinator.bindCommitted(a);
  let workspaceRuntime!: ReturnType<typeof useWorkspaceComposerDraftRuntime>;
  const currentOwner = () =>
    runtimeScope ? workspaceRuntime.composerDraftCoordinator! : h.coordinator;
  h.controller.setText("原始中😀 ");
  h.controller.ingestHTML(
    '<p><a href="https://example.invalid/marks" title="标题">链接中😀</a></p><pre><code class="language-typescript">const value = "中😀";</code></pre>',
  );
  h.controller.ingestPaste("历史粘贴验证😀 ".repeat(180));
  insertComposerSkill(h.controller, skill);
  h.controller.setInputCapabilityRoute(
    resolveInputCapabilitySendRoute({ kind: "installed_skill", skill }),
  );
  h.controller.setAttachments([
    { data: "cGljdHVyZQ==", mediaType: "image/png" },
  ]);
  h.controller.setPathReferences([
    {
      id: "file:/tmp/composer-reference.md",
      path: "/tmp/composer-reference.md",
      name: "composer-reference.md",
      isDir: false,
      source: "file_manager",
    },
  ]);
  h.controller.setSelection(1, 4);
  const original = h.controller.captureDraft();
  const restoreDraft = vi.spyOn(h.controller, "restoreDraft");
  const gate = deferred<unknown>();
  if (delayedConsume)
    h.intercept((command, args, execute) =>
      command === "persisted_atom_update" &&
      (args.mutation as { op: string }).op === "consume"
        ? gate.promise.then(execute)
        : execute(),
    );
  const stream = createRestoreTokenFixture();
  let latest!: ReturnType<typeof useInputbarController>;
  let setRequest!: React.Dispatch<
    React.SetStateAction<InterruptedInputRestoreRequest | null>
  >;
  let lastPayload: InputbarSendPayload | undefined;
  let stopping: Promise<void> | undefined;
  let stopBefore = -1;
  let scope = { projectId: "w", sessionId: "s1" };
  const onSend = vi.fn(async (payload: InputbarSendPayload = {}) => {
    lastPayload = payload;
    const prepared = prepareAgentStreamUserInputSend({
      content: payload.textOverride ?? "",
      images: payload.images ?? [],
      skipUserMessage: false,
      options: getInputbarSendOptions(payload),
      env: stream.env,
    });
    const receipt = await submitAgentStreamUserInput({
      preparedSend: prepared,
      env: stream.env,
    });
    // Test runtime projection anchors Stop to the actual accepted turn identity.
    stream.state.currentTurnId = receipt.turnId;
    return fromRuntimeAcceptanceReceipt(receipt);
  });
  const stop = () => {
    stopBefore = h.controller.getSnapshot().revision;
    stopping = stopActiveAgentStream({
      ...stream.stopOptions(),
      onRestoreInterruptedInput: (request) => {
        stream.onRestoreInterruptedInput(request);
        setRequest(request);
      },
    });
  };
  const handled = vi.fn();
  function InputbarHarness(props: Parameters<typeof useInputbarController>[0]) {
    latest = useInputbarController(props);
    return (
      <button data-testid="stop" onClick={latest.inputAdapter.actions.stop}>
        Stop
      </button>
    );
  }
  function Harness({
    owner = h.coordinator,
    onDraftAccepted,
  }: {
    owner?: ComposerDraftCoordinator;
    onDraftAccepted?: (
      capture: ComposerDraftCapture,
      result: AcceptedRuntimeSubmissionResult,
    ) => Promise<void> | void;
  } = {}) {
    const { snapshot } = useComposerController({ controller: h.controller });
    const [request, updateRequest] =
      useState<InterruptedInputRestoreRequest | null>(null);
    setRequest = updateRequest;
    const setInput = useCallback(
      (value: string) => h.controller.setText(value),
      [],
    );
    const onHandled = useCallback((id: string) => {
      handled(id);
      updateRequest((current) => (current?.requestId === id ? null : current));
    }, []);
    const clearPathReferences = useCallback(
      () => h.controller.setPathReferences([]),
      [],
    );
    const props = {
      composerController: h.controller,
      composerDraftCoordinator: persistent ? owner : undefined,
      onComposerDraftAccepted: onDraftAccepted,
      input: snapshot.document.text,
      setInput,
      onSend,
      onStop: stop,
      isLoading: !!stream.state.active,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      inputRestoreRequest: request,
      onInputRestoreRequestHandled: onHandled,
      skills: catalog,
      providerType: "openai",
      setProviderType: noop,
      model: "fixture",
      setModel: noop,
      onClearPathReferences: clearPathReferences,
    };
    return home ? <EmptyState {...props} /> : <InputbarHarness {...props} />;
  }
  function RuntimeHarness() {
    workspaceRuntime = useWorkspaceComposerDraftRuntime({
      controller: h.controller,
      initialScope: runtimeScope,
    });
    return (
      <Harness
        owner={workspaceRuntime.composerDraftCoordinator}
        onDraftAccepted={workspaceRuntime.handleComposerDraftAccepted}
      />
    );
  }
  const surface = () => (runtimeScope ? <RuntimeHarness /> : <Harness />);
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mounted.push({ root, element, h });
  await act(async () => root.render(surface()));
  const render = async () => act(async () => root.render(surface()));
  return {
    ...h,
    get coordinator() {
      return currentOwner();
    },
    get workspaceRuntime() {
      return workspaceRuntime;
    },
    stream,
    original,
    handled,
    restoreDraft,
    get payload() {
      return lastPayload!;
    },
    get stopBefore() {
      return stopBefore;
    },
    get current() {
      return latest;
    },
    scope,
    gate,
    async send() {
      await act(async () => {
        const result = await (home ? homePanel.send!() : latest.handleSend());
        if (
          typeof result !== "object" ||
          result === null ||
          !("kind" in result)
        )
          throw new Error("Fixture submission was not classified");
        if (result?.kind === "rejected")
          throw (
            ("error" in result ? result.error : undefined) ??
            new Error("Fixture submission rejected")
          );
        expect(result).toMatchObject({ kind: "runtime-accepted" });
      });
      if (!delayedConsume && persistent)
        await act(async () => {
          await currentOwner().idle();
        });
      await render();
    },
    async stop() {
      const beforeClick = h.controller.getSnapshot().revision;
      await act(async () => {
        element.querySelector<HTMLButtonElement>("button")!.click();
        await stopping;
      });
      return { beforeClick, atRuntimeStop: stopBefore };
    },
    async release() {
      await act(async () => {
        gate.resolve(null);
        await currentOwner().idle();
      });
      await render();
    },
    async commitVisibleRuntimeScope(next: DraftScope) {
      runtimeScope = next;
      await render();
    },
    async loadSkills(next: Skill[]) {
      catalog = next;
      await render();
    },
    async foreignScope() {
      if (persistent)
        await act(async () => {
          if (runtimeScope) workspaceRuntime.commitComposerDraftScope(b);
          else await h.coordinator.bindCommitted(b);
        });
      scope = { projectId: "other", sessionId: "other" };
      await render();
    },
  };
}

describe("actual Inputbar Stop across submission settlement, stream and draft owners", () => {
  it("restores the persistent complete draft through the EmptyState public Stop callback", async () => {
    const h = await setup({ home: true });
    await h.send();
    expect(h.controller.getDocument().text).toBe("");
    expect(
      canRestoreComposerSubmission({
        controller: h.controller,
        coordinator: h.coordinator,
        token: h.payload.composerRestoreToken,
        scope: h.scope,
      }),
    ).toBe(true);
    const stopRevisions = await h.stop();
    expect(h.stream.runtime.interruptTurn).toHaveBeenCalledOnce();
    expect(
      h.stream.onRestoreInterruptedInput.mock.calls[0][0].composerRestoreToken,
    ).toBe(h.payload.composerRestoreToken);
    expect(h.controller.captureDraft(), JSON.stringify(stopRevisions)).toEqual(
      h.original,
    );
    expect(h.restoreDraft).toHaveBeenCalledOnce();
    expect(h.handled).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "restores the complete output-free draft through the real Stop action (persistent=%s)",
    async (persistent) => {
      const h = await setup({ persistent });
      await h.send();
      expect(h.controller.getDocument().text).toBe("");
      const token = h.payload.composerRestoreToken;
      expect(h.stream.state.active?.composerRestoreToken).toBe(token);
      expect(
        canRestoreComposerSubmission({
          controller: h.controller,
          coordinator: persistent ? h.coordinator : undefined,
          token,
          scope: h.scope,
        }),
      ).toBe(true);
      const stopRevisions = await h.stop();
      expect(h.stream.runtime.interruptTurn).toHaveBeenCalledOnce();
      expect(h.stream.onRestoreInterruptedInput).toHaveBeenCalledOnce();
      expect(
        h.stream.onRestoreInterruptedInput.mock.calls[0][0]
          .composerRestoreToken,
      ).toBe(token);
      expect(
        h.controller.captureDraft(),
        JSON.stringify(stopRevisions),
      ).toEqual(h.original);
      expect(h.restoreDraft).toHaveBeenCalledOnce();
      expect(h.handled).toHaveBeenCalledOnce();
      for (const wire of [
        ...h.stream.runtime.submitOp.mock.calls,
        ...h.stream.runtime.interruptTurn.mock.calls,
      ]) {
        expect(JSON.stringify(wire)).not.toContain("composerRestoreToken");
        expect(JSON.stringify(wire)).not.toContain("composer-submission");
      }
    },
  );

  it("retains Stop restore while accepted local consumption is pending", async () => {
    const h = await setup({ delayedConsume: true });
    await h.send();
    await h.stop();
    expect(h.stream.onRestoreInterruptedInput).toHaveBeenCalledOnce();
    expect(h.handled).not.toHaveBeenCalled();
    await h.release();
    expect(h.controller.captureDraft()).toEqual(h.original);
    expect(h.restoreDraft).toHaveBeenCalledOnce();
    expect(h.handled).toHaveBeenCalledOnce();
  });

  it.each(["text", "attachments", "path", "capability", "foreign"] as const)(
    "keeps %s edits after acceptance safe from the previous Stop restore",
    async (kind) => {
      const h = await setup();
      await h.send();
      await act(async () => {
        if (kind === "text") h.controller.setText("后续草稿😀");
        if (kind === "attachments")
          h.controller.setAttachments([
            { data: "bmV3", mediaType: "image/jpeg" },
          ]);
        if (kind === "path")
          h.controller.setPathReferences([
            {
              id: "new",
              path: "/tmp/new.md",
              name: "new.md",
              isDir: false,
              source: "file_manager",
            },
          ]);
        if (kind === "capability")
          h.controller.setInputCapabilityRoute({
            kind: "builtin_command",
            commandKey: "image",
            commandPrefix: "@image",
          });
      });
      if (kind === "foreign") await h.foreignScope();
      const newer = h.controller.captureDraft();
      await h.stop();
      expect(h.controller.captureDraft()).toEqual(newer);
      expect(h.stream.onRestoreInterruptedInput).toHaveBeenCalledOnce();
      expect(h.handled).toHaveBeenCalledOnce();
    },
  );

  it("keeps a newer selection while local consumption was pending", async () => {
    const h = await setup({ delayedConsume: true });
    await h.send();
    await act(async () => {
      h.controller.setText("new draft selection");
      h.controller.setSelection(5, 7);
    });
    const newer = h.controller.captureDraft();
    await h.stop();
    await h.release();
    expect(h.controller.captureDraft()).toEqual(newer);
    expect(h.handled).toHaveBeenCalledOnce();
  });
});

describe("actual Inputbar restored skill identity", () => {
  it("keeps the exact rich draft while the skill catalog hydrates", async () => {
    const h = await setup({ initialSkills: [] });
    expect(h.controller.captureDraft()).toEqual(h.original);
    const revision = h.controller.getSnapshot().revision;
    await h.loadSkills(skills);
    expect(h.current.activeCapability).toBeNull();
    expect(h.controller.getDocument().mentionBindings).toEqual(
      h.original.mentionBindings,
    );
    expect(h.controller.captureDraft()).toEqual(h.original);
    expect(h.controller.getSnapshot().revision).toBe(revision);
  });

  it.each([false, true])(
    "deleting one skill atom preserves another without a selected route (catalog loaded=%s)",
    async (loaded) => {
      const h = await setup({ initialSkills: loaded ? skills : [] });
      expect(h.controller.captureDraft()).toEqual(h.original);
      await act(async () => {
        h.controller.setSelection(h.controller.getDocument().text.length);
        insertComposerSkill(h.controller, {
          ...skill,
          key: "user:other-report",
          directory: "/tmp/other-report",
        });
      });
      expect(h.controller.getDocument().inputCapabilityRoute).toEqual(
        h.original.inputCapabilityRoute,
      );
      await act(async () => {
        const selected = h.controller
          .getDocument()
          .mentionBindings.find((binding) => binding.id === skill.key)!;
        h.controller.replaceRange(
          { start: selected.from, end: selected.to },
          "",
        );
      });
      expect(h.controller.getDocument().mentionBindings).toMatchObject([
        { kind: "skill", id: "user:other-report" },
      ]);
      expect(h.controller.getDocument().inputCapabilityRoute).toBeUndefined();
      expect(h.current.activeCapability).toBeNull();
    },
  );
});

describe("Stop oracle after the actual Workspace Runtime lifecycle", () => {
  it.each(["local", "home", "draft"] as const)(
    "restores without intervening editing after %s Runtime acceptance/promotion",
    async (kind) => {
      const initial: DraftScope = {
        workspaceId: "w",
        kind,
        id:
          kind === "local"
            ? "session-1"
            : kind === "home"
              ? "new-conversation"
              : "draft-a",
      };
      const h = await setup({ runtimeScope: initial });
      await h.send();
      // Acceptance promotes the binding; the visible session must commit too.
      expect(h.workspaceRuntime.composerDraftRestoring).toBe(kind !== "local");
      await h.commitVisibleRuntimeScope({
        workspaceId: "w",
        kind: "local",
        id: "session-1",
      });
      expect(h.workspaceRuntime.composerDraftRestoring).toBe(false);
      expect(h.coordinator.getSnapshot()).toMatchObject({
        scope: { workspaceId: "w", kind: "local", id: "session-1" },
        identity: null,
      });
      expect(h.controller.getDocument().text).toBe("");
      expect(
        canRestoreComposerSubmission({
          controller: h.controller,
          coordinator: h.coordinator,
          token: h.payload.composerRestoreToken,
          scope: h.scope,
        }),
      ).toBe(true);
      await h.stop();
      expect(h.controller.captureDraft()).toEqual(h.original);
      expect(h.restoreDraft).toHaveBeenCalledOnce();
      expect(h.handled).toHaveBeenCalledOnce();
    },
  );

  it("metadata refresh after acceptance does not create a user edit or invalidate Stop", async () => {
    const h = await setup({
      runtimeScope: { workspaceId: "w", kind: "local", id: "session-1" },
    });
    await h.send();
    const revision = h.controller.getSnapshot().revision;
    await act(async () => {
      await h.coordinator.refresh();
    });
    expect(h.controller.getSnapshot().revision).toBe(revision);
    expect(h.coordinator.getSnapshot().identity).toBeNull();
    await h.stop();
    expect(h.controller.captureDraft()).toEqual(h.original);
    expect(h.restoreDraft).toHaveBeenCalledOnce();
  });

  it.each(["history-previous", "history-roundtrip", "restoreDraft"] as const)(
    "protects the newer revision from old Stop restoration after actual %s",
    async (action) => {
      const h = await setup({
        runtimeScope: { workspaceId: "w", kind: "local", id: "session-1" },
      });
      await h.send();
      const emptyRevision = h.controller.getSnapshot().revision;
      expect(h.coordinator.getSnapshot().identity).toBeNull();
      await act(async () => {
        if (action === "restoreDraft")
          h.controller.restoreDraft({
            ...h.original,
            attachments: [{ data: "later", mediaType: "image/jpeg" }],
          });
        else {
          expect(h.controller.recallHistory("previous")).not.toBeNull();
          if (action === "history-roundtrip")
            expect(h.controller.recallHistory("next")).not.toBeNull();
        }
        await h.coordinator.idle();
      });
      const newer = h.controller.captureDraft();
      const newerIdentity = h.coordinator.getSnapshot().identity;
      expect(h.controller.getSnapshot().revision).toBeGreaterThan(
        emptyRevision,
      );
      expect(newerIdentity).not.toBeNull();
      expect(
        canRestoreComposerSubmission({
          controller: h.controller,
          coordinator: h.coordinator,
          token: h.payload.composerRestoreToken,
          scope: h.scope,
        }),
      ).toBe(false);
      h.restoreDraft.mockClear();
      await h.stop();
      expect(
        h.stream.onRestoreInterruptedInput.mock.calls[0][0]
          .composerRestoreToken,
      ).toBe(h.payload.composerRestoreToken);
      expect(h.controller.captureDraft()).toEqual(newer);
      expect(h.coordinator.getSnapshot().identity).toEqual(newerIdentity);
      expect(h.restoreDraft).not.toHaveBeenCalled();
      expect(h.handled).toHaveBeenCalledOnce();
    },
  );
});
