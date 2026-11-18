import { describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { decodeComposerDraft } from "@/components/input-kit/composerDraftCodec";
import { ComposerDraftCoordinator } from "./ComposerDraftCoordinator";
import {
  a,
  b,
  home,
  local,
  accepted,
  queueAccepted,
  deferred,
  installCoordinatorHarness,
} from "./ComposerDraftCoordinator.testFixtures";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));

const setup = installCoordinatorHarness({ safeInvoke, safeListen });

describe("Composer draft coordination through explicit test-only bridge and real owners", () => {
  it("deduplicates acceptance reentered by a synchronous editor subscriber", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("submitted");
    const capture = h.coordinator.captureSubmission("start");
    let nested: Promise<boolean> | undefined;
    const unsubscribe = h.controller.subscribe(() => {
      if (h.controller.getDocument().text === "")
        nested = h.coordinator.settleSubmission(capture, accepted());
    });
    const cleanup = h.coordinator.settleSubmission(capture, accepted());
    expect(nested).toBe(cleanup);
    expect(await cleanup).toBe(true);
    unsubscribe();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "consume",
    ]);
  });
  it("persists a synchronous subscriber edit produced during accepted commit", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("submitted");
    const capture = h.coordinator.captureSubmission("start");
    let edited = false;
    const unsubscribe = h.controller.subscribe(() => {
      if (!edited && h.controller.getDocument().text === "") {
        edited = true;
        h.controller.setText("synchronous new edit");
      }
    });
    await h.coordinator.settleSubmission(capture, accepted());
    await h.coordinator.idle();
    unsubscribe();
    expect(h.controller.getDocument().text).toBe("synchronous new edit");
    const entry = await h.read(a);
    expect(entry?.state).toBe("draft");
    if (entry?.state !== "draft") throw new Error("new edit was not persisted");
    expect(decodeComposerDraft(entry.draft).document.text).toBe(
      "synchronous new edit",
    );
    expect(entry.draftId).not.toBe(capture.binding!.identity.draftId);
  });
  it("fixes capture payload before send continues and serializes put before consume", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("captured");
    const gate = deferred<unknown>();
    let once = true;
    h.intercept((command, _args, execute) => {
      if (command === "persisted_atom_update" && once) {
        once = false;
        return gate.promise.then(execute);
      }
      return execute();
    });
    const capture = h.coordinator.captureSubmission("start");
    const businessSend = vi.fn(() => accepted());
    const actual = businessSend();
    const cleanup = h.coordinator.settleSubmission(capture, actual);
    expect(businessSend).toHaveBeenCalledOnce();
    expect(h.controller.captureDraft().text).toBe("");
    h.controller.setText("later edit");
    gate.resolve(null);
    expect(await cleanup).toBe(true);
    await h.coordinator.idle();
    expect(h.mutations.slice(0, 2).map((mutation) => mutation.op)).toEqual([
      "put",
      "consume",
    ]);
    const put = h.mutations[0];
    if (put.op !== "put") throw new Error("missing put");
    expect(decodeComposerDraft(put.draft).document.text).toBe("captured");
    expect(capture.receipt.submission.text).toBe("captured");
    expect(h.controller.captureDraft().text).toBe("later edit");
    const later = await h.read(a);
    expect(later?.state).toBe("draft");
    expect(later?.draftId).not.toBe(capture.binding!.identity.draftId);
  });

  it("commits matching UI on acceptance and creates no empty put", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("submitted");
    const capture = h.coordinator.captureSubmission("start");
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await h.coordinator.idle();
    expect(h.controller.captureDraft().text).toBe("");
    expect(await h.read(a)).toBeNull();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "consume",
    ]);
    expect(h.controller.getHistory()[0].text).toBe("submitted");
  });

  it("keeps an accepted draft cleared while a delayed consume receives older put notifications", async () => {
    const h = await setup();
    await h.coordinator.connect();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("submitted");
    const gate = deferred<unknown>();
    h.intercept((command, args, execute) => {
      if (
        command === "persisted_atom_update" &&
        (args.mutation as { op: string }).op === "consume"
      )
        return gate.promise.then(execute);
      return execute();
    });
    const capture = h.coordinator.captureSubmission("start");
    const cleanup = h.coordinator.settleSubmission(capture, accepted());
    expect(h.controller.captureDraft().text).toBe("");
    await vi.advanceTimersByTimeAsync(0);
    await h.coordinator.refresh();
    expect((await h.read(a))?.state).toBe("draft");
    expect(h.controller.captureDraft().text).toBe("");
    gate.resolve(null);
    expect(await cleanup).toBe(true);
    await h.coordinator.refresh();
    expect(h.controller.captureDraft().text).toBe("");
    expect(await h.read(a)).toBeNull();
  });

  it("clears accepted input without an available persistence binding and deduplicates the receipt", async () => {
    const h = await setup();
    h.controller.setText("submitted without storage");
    const capture = h.coordinator.captureSubmission("start");
    expect(capture.binding).toBeNull();
    const first = h.coordinator.settleSubmission(capture, accepted());
    expect(h.controller.captureDraft().text).toBe("");
    h.controller.setText("new edit");
    expect(h.coordinator.settleSubmission(capture, accepted())).toBe(first);
    expect(await first).toBe(true);
    expect(h.controller.captureDraft().text).toBe("new edit");
    expect(h.mutations).toHaveLength(0);
  });

  it("consumes accepted source after navigation while preserving the new scope document", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("sent a");
    const capture = h.coordinator.captureSubmission("start");
    await h.coordinator.bindCommitted(b);
    h.controller.setText("editing b");
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      false,
    );
    await h.coordinator.idle();
    expect(await h.read(a)).toBeNull();
    expect(h.controller.captureDraft().text).toBe("editing b");
  });

  it("does not commit a receipt after navigating away and back to the same identity", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("sent");
    const capture = h.coordinator.captureSubmission("start");
    await h.coordinator.idle();
    await h.coordinator.bindCommitted(b);
    await h.coordinator.bindCommitted(a);
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      false,
    );
    expect(h.controller.captureDraft().text).toBe("sent");
    expect(await h.read(a)).toBeNull();
  });

  it("keeps capture immutable and deduplicates observer/return acceptance", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("sent");
    const capture = h.coordinator.captureSubmission("start");
    expect(() => {
      (capture.binding!.identity as { scopeVersion: string }).scopeVersion =
        "mutated";
    }).toThrow();
    const first = h.coordinator.settleSubmission(capture, accepted());
    expect(h.coordinator.settleSubmission(capture, accepted())).toBe(first);
    await first;
    expect(
      h.mutations.filter((mutation) => mutation.op === "consume"),
    ).toHaveLength(1);
  });

  it.each([
    undefined,
    true,
    false,
    { kind: "unknown" },
    { kind: "local-handled" },
    { kind: "rejected" },
    { kind: "runtime-accepted", receipt: {} },
  ])("does not consume from nonacceptance %j", async (result) => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("keep");
    const capture = h.coordinator.captureSubmission("start");
    expect(await h.coordinator.settleSubmission(capture, result)).toBe(false);
    await h.coordinator.idle();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual(["put"]);
    expect(h.controller.captureDraft().text).toBe("keep");
  });

  it("can still consume a later real observer acceptance after an unknown return", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("keep");
    const capture = h.coordinator.captureSubmission("start");
    await h.coordinator.settleSubmission(capture, { kind: "unknown" });
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      true,
    );
  });

  it("supports the existing real queue acceptance owner", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("queue");
    const capture = h.coordinator.captureSubmission("queue");
    expect(await h.coordinator.settleSubmission(capture, queueAccepted())).toBe(
      true,
    );
  });

  it("does not consume empty or interrupt captures", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    expect(
      await h.coordinator.settleSubmission(
        h.coordinator.captureSubmission("start"),
        accepted(),
      ),
    ).toBe(false);
    h.controller.setText("keep");
    expect(
      await h.coordinator.settleSubmission(
        h.coordinator.captureSubmission("interrupt"),
        accepted(),
      ),
    ).toBe(false);
    await h.coordinator.idle();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual(["put"]);
  });

  it.each([a, home])(
    "promotes captured scope %j without changing logical identity or Controller receipt",
    async (source) => {
      const h = await setup();
      await h.coordinator.bindCommitted(source);
      h.controller.setText("promote");
      const capture = h.coordinator.captureSubmission("start");
      const revision = h.controller.getSnapshot().revision;
      expect(
        await h.coordinator.promote(capture.binding!, local, {
          expectedTarget: null,
          sessionId: "s1",
          threadId: "t1",
        }),
      ).toBe(true);
      expect(h.controller.getSnapshot().revision).toBe(revision);
      expect(h.coordinator.getSnapshot().identity).toEqual(
        capture.binding!.identity,
      );
      expect(h.coordinator.getSnapshot().scope).toEqual(local);
      expect(await h.read(source)).toBeNull();
      expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
        true,
      );
      expect(await h.read(local)).toBeNull();
    },
  );

  it("routes edits enqueued during promotion to the successfully promoted binding", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("first");
    const token = h.coordinator.captureBinding()!;
    const gate = deferred<unknown>();
    h.intercept((command, args, execute) =>
      command === "persisted_atom_update" &&
      (args.mutation as { op: string }).op === "promote"
        ? gate.promise.then(execute)
        : execute(),
    );
    const promotion = h.coordinator.promote(token, local, {
      expectedTarget: null,
      sessionId: "s1",
    });
    h.controller.setText("edited during promotion");
    h.coordinator.captureBinding();
    gate.resolve(null);
    expect(await promotion).toBe(true);
    await h.coordinator.idle();
    expect(h.coordinator.getSnapshot().mutation).toBe("applied");
    const final = await h.read(local);
    if (final?.state !== "draft") throw new Error("missing promoted draft");
    expect(decodeComposerDraft(final.draft).document.text).toBe(
      "edited during promotion",
    );
  });

  it("preserves source and target on a promotion conflict", async () => {
    const h = await setup();
    h.seed(local, "occupied");
    await h.coordinator.bindCommitted(a);
    h.controller.setText("source");
    const token = h.coordinator.captureBinding()!;
    expect(
      await h.coordinator.promote(token, local, {
        expectedTarget: null,
        sessionId: "s1",
      }),
    ).toBe(false);
    expect(h.coordinator.getSnapshot().scope).toEqual(a);
    expect(h.controller.captureDraft().text).toBe("source");
    expect((await h.read(local))?.draftId).toBe("seed-local-s1");
  });

  it("clears with a tombstone and never revives the retired draft ID", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("old");
    const old = h.coordinator.captureBinding()!;
    expect(await h.coordinator.clear()).toBe(true);
    await h.coordinator.clear();
    expect(
      h.store.updatePersistedAtomState({
        op: "put",
        scope: a,
        draftId: old.identity.draftId,
        expectedVersion: null,
        nextVersion: "late",
        draft: old.payload,
      }).reason,
    ).toBe("retired_draft");
    h.controller.setText("new");
    const fresh = h.coordinator.captureBinding()!;
    expect(fresh.identity.draftId).not.toBe(old.identity.draftId);
    await h.coordinator.idle();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "clear",
      "put",
    ]);
  });

  it("observes explicit Controller clear as discard rather than an ordinary empty put", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("old");
    h.controller.clear();
    await h.coordinator.idle();
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "clear",
    ]);
    expect(await h.read(a)).toBeNull();
  });

  it("clears accepted local input while preserving a conflicting remote draft", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("local");
    const capture = h.coordinator.captureSubmission("start");
    await h.coordinator.idle();
    const token = capture.binding!;
    h.store.updatePersistedAtomState({
      op: "put",
      scope: a,
      draftId: token.identity.draftId,
      expectedVersion: token.identity.scopeVersion,
      nextVersion: "other-window",
      draft: token.payload,
    });
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      true,
    );
    expect(h.controller.captureDraft().text).toBe("");
    expect(h.coordinator.getSnapshot().mutation).toBe("conflict");
    expect((await h.read(a))?.scopeVersion).toBe("other-window");
    await h.coordinator.refresh();
    expect(h.controller.captureDraft().text).toBe("");
  });

  it("flushes newer local edits before an older acceptance so its CAS cannot consume them", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("captured");
    const capture = h.coordinator.captureSubmission("start");
    h.controller.setText("already newer");
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      false,
    );
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "put",
      "consume",
    ]);
    const entry = await h.read(a);
    if (entry?.state !== "draft") throw new Error("new draft missing");
    expect(decodeComposerDraft(entry.draft).document.text).toBe(
      "already newer",
    );
    expect(h.controller.captureDraft().text).toBe("already newer");
  });

  it("captures even a cyclic unsupported route without blocking the business payload", async () => {
    await setup();
    const route: Record<string, unknown> = {};
    route.self = route;
    const controller = new ComposerController({
      text: "send",
      inputCapabilityRoute: route,
    });
    const coordinator = new ComposerDraftCoordinator(controller, {
      plainTextMode: false,
    });
    await coordinator.bindCommitted(a);
    const capture = coordinator.captureSubmission("start");
    expect(capture.binding).toBeNull();
    expect(capture.receipt.submission.text).toBe("send");
    expect(await coordinator.settleSubmission(capture, accepted())).toBe(false);
    coordinator.detach();
  });

  it("reports a conflicting explicit clear while retaining another window's stored version", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("old");
    const token = h.coordinator.captureBinding()!;
    await h.coordinator.idle();
    h.store.updatePersistedAtomState({
      op: "put",
      scope: a,
      draftId: token.identity.draftId,
      expectedVersion: token.identity.scopeVersion,
      nextVersion: "remote-version",
      draft: token.payload,
    });
    expect(await h.coordinator.clear()).toBe(false);
    expect(h.coordinator.getSnapshot().mutation).toBe("conflict");
    expect((await h.read(a))?.scopeVersion).toBe("remote-version");
  });

  it("clears runtime-accepted input despite draft transport failure without claiming it was saved", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("keep");
    h.intercept((command, _args, execute) => {
      if (command === "persisted_atom_update")
        throw new Error("private draft echo");
      return execute();
    });
    const capture = h.coordinator.captureSubmission("start");
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      true,
    );
    expect(h.controller.captureDraft().text).toBe("");
    expect(h.coordinator.getSnapshot().mutation).toBe("unavailable");
    expect(JSON.stringify(h.coordinator.getSnapshot())).not.toContain(
      "private",
    );
  });

  it("distinguishes applied in memory from saved on disk and preserves old savedRevision after IO error", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("keep");
    await h.coordinator.idle();
    expect(h.coordinator.getSnapshot().mutation).toBe("applied");
    expect(h.coordinator.getSnapshot().persistence?.state).toBe("pending");
    h.failWrite(true);
    await h.store.flush();
    await h.coordinator.refresh();
    expect(h.coordinator.getSnapshot().persistence?.state).toBe("error");
    expect(h.coordinator.getSnapshot().persistence?.savedRevision).toBe(0);
    expect(h.controller.captureDraft().text).toBe("keep");
    h.failWrite(false);
    await h.store.flush();
    await h.coordinator.refresh();
    expect(h.coordinator.getSnapshot().persistence?.state).toBe("saved");
    expect(h.coordinator.getSnapshot().persistence?.savedRevision).toBe(
      h.coordinator.getSnapshot().storeRevision,
    );
  });

  it("keeps local and stored documents intact on codec failure and still captures a business receipt", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("keep");
    await h.coordinator.idle();
    h.controller.setInputCapabilityRoute({
      unsupported: new Map([["secret", "value"]]),
    });
    const capture = h.coordinator.captureSubmission("start");
    expect(capture.receipt.kind).toBe("accepted");
    expect(capture.binding).toBeNull();
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      false,
    );
    await h.coordinator.idle();
    expect(h.mutations).toHaveLength(1);
    expect(h.controller.captureDraft().text).toBe("keep");
    expect((await h.read(a))?.state).toBe("draft");
  });

  it("keeps fixed mutations alive after UI detaches and later runtime acceptance arrives", async () => {
    const h = await setup();
    await h.coordinator.bindCommitted(a);
    h.controller.setText("sent");
    const capture = h.coordinator.captureSubmission("start");
    h.coordinator.detach();
    expect(await h.coordinator.settleSubmission(capture, accepted())).toBe(
      false,
    );
    await h.coordinator.idle();
    expect(await h.read(a)).toBeNull();
    expect(h.controller.captureDraft().text).toBe("sent");
    expect(h.mutations.map((mutation) => mutation.op)).toEqual([
      "put",
      "consume",
    ]);
  });

  it("does not evict tombstones to make room for a new logical draft", async () => {
    const h = await setup({
      limits: {
        maxEntries: 1,
        maxBindings: 1,
        maxDraftBytes: 8_192,
        maxFileBytes: 16_384,
      },
    });
    await h.coordinator.bindCommitted(a);
    h.controller.setText("old");
    await h.coordinator.clear();
    h.controller.setText("new");
    await h.coordinator.idle();
    expect(h.coordinator.getSnapshot().mutation).toBe("invalid");
    expect(h.controller.captureDraft().text).toBe("new");
    expect(await h.read(a)).toBeNull();
  });
});
