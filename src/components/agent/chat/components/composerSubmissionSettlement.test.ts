import { decodeComposerDraft } from "@/components/input-kit/composerDraftCodec";
import { describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  a,
  b,
  local,
  accepted,
  queueAccepted,
  deferred,
  installCoordinatorHarness,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import {
  canRestoreComposerSubmission,
  createComposerSubmissionSettlement,
} from "./composerSubmissionSettlement";
import { isRuntimeSubmissionAccepted } from "../hooks/agentSendResult";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
const setup = installCoordinatorHarness({ safeInvoke, safeListen });

async function persistent() {
  const h = await setup();
  await h.coordinator.bindCommitted(a);
  h.controller.setText("captured");
  const onCommitted = vi.fn();
  const onAccepted = vi.fn();
  const settlement = createComposerSubmissionSettlement({
    controller: h.controller,
    coordinator: h.coordinator,
    target: "start",
    scope: { projectId: "w", sessionId: "s1" },
    canApplyUi: () => true,
    onAccepted,
    onCommitted,
  });
  const restore = () =>
    canRestoreComposerSubmission({
      controller: h.controller,
      coordinator: h.coordinator,
      token: settlement.composerRestoreToken,
      scope: { projectId: "w", sessionId: "s1" },
    });
  return { ...h, settlement, onAccepted, onCommitted, restore };
}

describe("Composer submission settlement through real Coordinator/Store owners", () => {
  it.each([false, true])(
    "ignores a scope read crossing accepted retirement (snapshotBeforeConsume=%s)",
    async (snapshotBeforeConsume) => {
      const h = await persistent();
      await h.coordinator.idle();
      const gate = deferred<unknown>();
      let once = true;
      h.intercept((command, _args, execute) => {
        if (command !== "persisted_atom_read" || !once) return execute();
        once = false;
        const before = snapshotBeforeConsume ? execute() : undefined;
        return gate.promise.then(() =>
          snapshotBeforeConsume ? before : execute(),
        );
      });
      const oldRead = h.coordinator.refresh();
      h.settlement.finish(accepted());
      expect(await h.settlement.cleanup).toBe(true);
      const revision = h.controller.getSnapshot().revision;
      expect(h.coordinator.getSnapshot().identity).toBeNull();
      gate.resolve(null);
      await oldRead;
      await h.coordinator.idle();
      expect(h.controller.getSnapshot().revision).toBe(revision);
      expect(h.controller.getDocument().text).toBe("");
      expect(h.coordinator.getSnapshot().identity).toBeNull();
      expect(h.mutations.map((mutation) => mutation.op)).toEqual([
        "put",
        "consume",
      ]);
      expect(h.restore()).toBe(true);
    },
  );

  it("captures once, accepts before delayed storage and restores only after exact consume", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("captured");
    const gate = deferred<unknown>();
    h.intercept((command, args, execute) =>
      command === "persisted_atom_update" &&
      (args.mutation as { op: string }).op === "consume"
        ? gate.promise.then(execute)
        : execute(),
    );
    const submit = vi.spyOn(h.controller, "submit");
    const commit = vi.spyOn(h.controller, "commit");
    const onCommitted = vi.fn();
    const settlement = createComposerSubmissionSettlement({
      controller: h.controller,
      coordinator: h.coordinator,
      target: "start",
      scope: {},
      canApplyUi: () => true,
      onCommitted,
    });
    const result = accepted();
    if (!isRuntimeSubmissionAccepted(result))
      throw new Error("test acceptance invalid");
    settlement.onRuntimeAccepted(result.receipt);
    expect(settlement.finish({ kind: "rejected" })).toEqual(result);
    expect(submit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(h.controller.getDocument().text).toBe("");
    expect(
      canRestoreComposerSubmission({
        controller: h.controller,
        coordinator: h.coordinator,
        token: settlement.composerRestoreToken,
        scope: {},
      }),
    ).toBe(false);
    gate.resolve(null);
    await settlement.cleanup;
    await h.coordinator.idle();
    expect(commit).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(h.mutations.map((x) => x.op)).toEqual(["put", "consume"]);
    expect(
      canRestoreComposerSubmission({
        controller: h.controller,
        coordinator: h.coordinator,
        token: settlement.composerRestoreToken,
        scope: {},
      }),
    ).toBe(true);
  });

  it("deduplicates early/returned runtime acceptance and keeps acceptance after rejection", async () => {
    const h = await persistent();
    const result = accepted();
    if (!isRuntimeSubmissionAccepted(result))
      throw new Error("test acceptance invalid");
    h.settlement.onRuntimeAccepted(result.receipt);
    h.settlement.onRuntimeAccepted(result.receipt);
    expect(h.settlement.finish(result)).toEqual(result);
    expect(h.settlement.reject(new Error("postprocessing"))).toEqual(result);
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.onAccepted).toHaveBeenCalledOnce();
    expect(h.onCommitted).toHaveBeenCalledOnce();
    expect(h.mutations.filter((x) => x.op === "consume")).toHaveLength(1);
  });

  it("consumes queue acceptance with the original queued submission object", async () => {
    const h = await persistent();
    const result = queueAccepted();
    const actual = h.settlement.finish(result);
    expect(actual.kind).toBe("queue-accepted");
    if (actual.kind !== "queue-accepted" || result.kind !== "queue-accepted")
      throw new Error("test queue invalid");
    expect(actual.receipt.submission).toBe(result.receipt.submission);
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.onCommitted).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    true,
    false,
    { kind: "unknown" },
    { kind: "local-handled" },
    { kind: "rejected" },
    { kind: "runtime-accepted", receipt: {} },
  ])(
    "keeps the draft and disables restore for ambiguous/nonacceptance %j",
    async (result) => {
      const h = await persistent();
      h.settlement.finish(result);
      await h.settlement.cleanup;
      await h.coordinator.idle();
      expect(h.controller.getDocument().text).toBe("captured");
      expect(h.mutations.map((x) => x.op)).toEqual(["put"]);
      expect(h.onCommitted).not.toHaveBeenCalled();
      expect(h.restore()).toBe(false);
    },
  );

  it("settles a late real observer after an unknown return", async () => {
    const h = await persistent();
    expect(h.settlement.finish(undefined)).toEqual({ kind: "unknown" });
    const result = accepted();
    if (!isRuntimeSubmissionAccepted(result))
      throw new Error("test acceptance invalid");
    h.settlement.onRuntimeAccepted(result.receipt);
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.restore()).toBe(true);
  });

  it("consumes the captured source after navigation and keeps the new scope", async () => {
    const h = await persistent();
    await h.coordinator.bindCommitted(b);
    h.controller.setText("editing b");
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(await h.read(a)).toBeNull();
    expect(h.controller.getDocument().text).toBe("editing b");
    expect(h.onCommitted).not.toHaveBeenCalled();
    expect(h.restore()).toBe(false);
  });

  it("continues captured consumption after detach without committing detached UI", async () => {
    const h = await persistent();
    h.coordinator.detach();
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(await h.read(a)).toBeNull();
    expect(h.controller.getDocument().text).toBe("captured");
    expect(h.onCommitted).not.toHaveBeenCalled();
    expect(h.restore()).toBe(false);
  });

  it("does not consume a newer edit or provide its restore capability", async () => {
    const h = await persistent();
    h.controller.setText("later edit");
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.controller.getDocument().text).toBe("later edit");
    expect((await h.read(a))?.state).toBe("draft");
    expect(h.onCommitted).not.toHaveBeenCalled();
    expect(h.restore()).toBe(false);
  });

  it("records the actual promoted target for restoration", async () => {
    const h = await persistent();
    const binding = h.coordinator.captureBinding();
    if (!binding) throw new Error("missing test binding");
    await h.coordinator.promote(binding, local, {
      expectedTarget: null,
      sessionId: "s1",
      threadId: "t1",
    });
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.coordinator.getSnapshot().scope).toEqual(local);
    expect(h.restore()).toBe(true);
    await h.coordinator.bindCommitted(b);
    await h.coordinator.bindCommitted(local);
    expect(h.restore()).toBe(false);
  });

  it("rejects later edits and a cloned/foreign/missing token", async () => {
    const h = await persistent();
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    expect(h.restore()).toBe(true);
    expect(
      canRestoreComposerSubmission({
        controller: h.controller,
        coordinator: h.coordinator,
        scope: {},
      }),
    ).toBe(false);
    expect(
      canRestoreComposerSubmission({
        controller: h.controller,
        coordinator: h.coordinator,
        token: { kind: "composer-submission" },
        scope: {},
      }),
    ).toBe(false);
    expect(
      canRestoreComposerSubmission({
        controller: new ComposerController(),
        coordinator: h.coordinator,
        token: h.settlement.composerRestoreToken,
        scope: {},
      }),
    ).toBe(false);
    h.controller.setText("new edit");
    expect(h.restore()).toBe(false);
  });

  it("keeps acceptance when observers/UI postprocessing throw", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("captured");
    const settlement = createComposerSubmissionSettlement({
      controller: h.controller,
      coordinator: h.coordinator,
      target: "start",
      scope: {},
      canApplyUi: () => true,
      onAccepted: () => {
        throw new Error("observer");
      },
      onCommitted: () => {
        throw new Error("ui");
      },
    });
    const actual = settlement.finish(accepted());
    expect(actual.kind).toBe("runtime-accepted");
    await settlement.cleanup;
    await h.coordinator.idle();
    expect(h.controller.getDocument().text).toBe("");
    expect(settlement.reject(new Error("later"))).toEqual(actual);
  });

  it("does not clear a synchronous newer edit after Controller commit", async () => {
    const h = await persistent();
    const stop = h.controller.subscribe(() => {
      if (h.controller.getDocument().text === "")
        h.controller.setText("synchronous new edit");
    });
    h.settlement.finish(accepted());
    await h.settlement.cleanup;
    await h.coordinator.idle();
    stop();
    expect(h.controller.getDocument().text).toBe("synchronous new edit");
    const newDraft = await h.read(a);
    expect(newDraft?.state).toBe("draft");
    expect(newDraft?.draftId).not.toBe(
      h.settlement.composerDraftCapture!.binding!.identity.draftId,
    );
    if (newDraft?.state !== "draft") throw new Error("missing reentrant edit");
    expect(decodeComposerDraft(newDraft.draft).document.text).toBe(
      "synchronous new edit",
    );
    expect(h.onCommitted).not.toHaveBeenCalled();
    expect(h.restore()).toBe(false);
  });

  it("keeps transient restore bound to the same project/session and revision", () => {
    const controller = new ComposerController({ text: "transient" });
    const onCommitted = vi.fn();
    const settlement = createComposerSubmissionSettlement({
      controller,
      target: "start",
      scope: { projectId: "p1", sessionId: "s1" },
      canApplyUi: () => true,
      onCommitted,
    });
    settlement.finish(accepted());
    expect(onCommitted).toHaveBeenCalledOnce();
    const restore = (projectId: string, sessionId: string) =>
      canRestoreComposerSubmission({
        controller,
        token: settlement.composerRestoreToken,
        scope: { projectId, sessionId },
      });
    expect(restore("p1", "s1")).toBe(true);
    expect(restore("p2", "s1")).toBe(false);
    expect(restore("p1", "s2")).toBe(false);
    controller.setText("edited");
    expect(restore("p1", "s1")).toBe(false);
    expect(canRestoreComposerSubmission({ controller, scope: {} })).toBe(true);
  });
  it("clears accepted input immediately while waiting for root promotion before consuming", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("capture");
    const gate = deferred<void>();
    const onDraftAccepted = vi.fn(() => gate.promise);
    const settlement = createComposerSubmissionSettlement({
      controller: h.controller,
      coordinator: h.coordinator,
      target: "start",
      scope: {},
      canApplyUi: () => true,
      onDraftAccepted,
      onCommitted: vi.fn(),
    });
    const result = accepted();
    const actual = settlement.finish(result);
    expect(h.controller.getDocument().text).toBe("");
    await vi.advanceTimersByTimeAsync(0);
    expect(actual.kind).toBe("runtime-accepted");
    expect(h.mutations.filter((x) => x.op === "consume")).toHaveLength(0);
    expect(onDraftAccepted).toHaveBeenCalledExactlyOnceWith(
      settlement.composerDraftCapture,
      actual,
    );
    gate.reject(new Error("promotion CAS failed"));
    await settlement.cleanup;
    await h.coordinator.idle();
    expect(h.mutations.map((x) => x.op)).toEqual(["put", "consume"]);
    expect(h.controller.getDocument().text).toBe("");
    expect(settlement.finish({ kind: "rejected" })).toEqual(actual);
  });

  it("preserves new input at the promoted scope while accepted cleanup is pending", async () => {
    const h = await setup();
    await h.coordinator.connect();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("submitted");
    const gate = deferred<void>();
    h.intercept((command, args, execute) => {
      if (
        command === "persisted_atom_update" &&
        (args.mutation as { op: string }).op === "promote"
      )
        return gate.promise.then(execute);
      return execute();
    });
    const settlement = createComposerSubmissionSettlement({
      controller: h.controller,
      coordinator: h.coordinator,
      target: "start",
      scope: {},
      canApplyUi: () => true,
      onDraftAccepted: async (capture) => {
        await h.coordinator.promote(capture.binding!, local, {
          expectedTarget: null,
          sessionId: "s1",
          threadId: "t1",
        });
        await h.coordinator.bindCommitted(local);
      },
      onCommitted: vi.fn(),
    });
    settlement.finish(accepted());
    expect(h.controller.getDocument().text).toBe("");
    h.controller.setText("new draft");
    await vi.advanceTimersByTimeAsync(250);
    gate.resolve();
    await settlement.cleanup;
    await h.coordinator.idle();
    await h.coordinator.refresh();
    expect(h.controller.getDocument().text).toBe("new draft");
    expect(h.coordinator.getSnapshot().scope).toEqual(local);
    const stored = await h.read(local);
    expect(stored?.state).toBe("draft");
    expect(await h.read(a)).toBeNull();
  });
});
