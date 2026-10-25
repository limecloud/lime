import { Buffer } from "node:buffer";
import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DraftScope,
  PersistedAtomMetadata,
} from "../src/lib/api/persistedAtomTypes";
import { persistedAtomFileIO } from "./persistedAtomFile";
import { PersistedAtomStore } from "./persistedAtomStore";
import {
  cleanup,
  createRoot,
  createStore,
  deferred,
  entry,
  home,
  identity,
  limits,
  local,
  promotion,
  put,
  trackStore,
} from "./persistedAtomStore.test-support";
afterEach(cleanup);

describe("persisted atom Main CAS and draft lifecycle", () => {
  it("returns explicit loading unavailability without accepting or awaiting a put", async () => {
    const root = await createRoot(),
      gate = deferred<Buffer>();
    const store = new PersistedAtomStore(root, {
      limits,
      io: { ...persistedAtomFileIO, readFile: () => gate.promise },
    });
    trackStore(store);
    expect(
      store.sendPersistedAtomState({ kind: "scope", scope: home }),
    ).toMatchObject({
      outcome: "unavailable",
      persistence: { state: "loading" },
      data: null,
    });
    const result = store.updatePersistedAtomState(put());
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({
      outcome: "unavailable",
      changed: false,
      storeRevision: 0,
    });
    gate.resolve(Buffer.from("invalid"));
    await store.ready;
    expect(
      store.sendPersistedAtomState({ kind: "scope", scope: home }),
    ).toMatchObject({
      outcome: "unavailable",
      persistence: { state: "unavailable" },
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("accepts a complete rich draft synchronously before durable IO", async () => {
    const { root, store } = await createStore();
    expect(store.updatePersistedAtomState(put())).toMatchObject({
      outcome: "applied",
      changed: true,
      storeRevision: 1,
      persistence: { state: "pending", savedRevision: 0 },
    });
    expect(await readdir(root)).toEqual([]);
    const draft = put();
    expect(entry(store)?.state).toBe("draft");
    expect(entry(store)).toMatchObject({
      draftId: "d1",
      scopeVersion: "v1",
      draft: "draft" in draft ? draft.draft : null,
    });
    await store.flush();
    expect(store.metadata()).toMatchObject({
      persistence: { state: "saved", savedRevision: 1 },
    });
  });

  it("uses exact expected versions and does not rebase a stale writer", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    expect(
      store.updatePersistedAtomState(put(home, "d1", "v2", "v1", "new edit")),
    ).toMatchObject({ outcome: "applied", storeRevision: 2 });
    expect(
      store.updatePersistedAtomState(
        put(home, "d1", "stale", "v1", "stale overwrite"),
      ),
    ).toMatchObject({
      outcome: "conflict",
      reason: "version_conflict",
      changed: false,
      storeRevision: 2,
    });
    expect(entry(store)).toMatchObject({
      scopeVersion: "v2",
      draft: { text: "new edit" },
    });
    expect(
      store.updatePersistedAtomState(put(home, "other", "v1")),
    ).toMatchObject({
      outcome: "conflict",
      reason: "identity_mismatch",
    });
    expect(
      store.updatePersistedAtomState(put(home, "d1", "v2", "v2")),
    ).toMatchObject({
      outcome: "invalid",
      reason: "version_conflict",
    });
  });

  it("isolates home/draft/session and workspace namespaces", async () => {
    const { store } = await createStore();
    const scopes: DraftScope[] = [
      home,
      { ...home, workspaceId: "w" },
      { workspaceId: "w", kind: "draft", id: "tab-1" },
      local,
    ];
    scopes.forEach((scope, index) =>
      expect(
        store.updatePersistedAtomState(
          put(scope, `draft-${index}`, `v-${index}`, null, `scope ${index}`),
        ).outcome,
      ).toBe("applied"),
    );
    scopes.forEach((scope, index) =>
      expect(entry(store, scope)).toMatchObject({
        draftId: `draft-${index}`,
        draft: { text: `scope ${index}` },
      }),
    );
    expect(entry(store, local)).toMatchObject({ sessionId: "session-1" });
  });

  it.each([
    { name: "Home without tab", scope: home },
    {
      name: "direct draft",
      scope: {
        workspaceId: "w",
        kind: "draft",
        id: "tab-direct",
      } as DraftScope,
    },
    {
      name: "materialized draft",
      scope: {
        workspaceId: "w",
        kind: "draft",
        id: "tab-materialized",
      } as DraftScope,
    },
  ])(
    "promotes $name without changing logical draft/version/payload",
    async ({ scope }) => {
      const { store } = await createStore();
      store.updatePersistedAtomState(put(scope));
      const before = entry(store, scope);
      const result = store.updatePersistedAtomState(promotion(scope));
      expect(result).toMatchObject({
        outcome: "applied",
        changed: true,
        storeRevision: 2,
      });
      expect(entry(store, scope)).toBeNull();
      expect(entry(store, local)).toMatchObject({
        draftId: before?.draftId,
        scopeVersion: before?.scopeVersion,
        originScopeKey: before?.originScopeKey,
        sessionId: "session-1",
        draft: before?.state === "draft" ? before.draft : null,
      });
      expect(store.updatePersistedAtomState(promotion(scope))).toMatchObject({
        outcome: "applied",
        changed: false,
        storeRevision: 2,
      });
    },
  );

  it("keeps both source and occupied target intact when promotion conflicts", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState(
      put(local, "target", "target-v1", null, "target text"),
    );
    const beforeSource = entry(store),
      beforeTarget = entry(store, local);
    expect(store.updatePersistedAtomState(promotion())).toMatchObject({
      outcome: "conflict",
      reason: "target_conflict",
      storeRevision: 2,
    });
    expect(entry(store)).toEqual(beforeSource);
    expect(entry(store, local)).toEqual(beforeTarget);
  });

  it("does not overwrite a target even if the caller supplies its expected identity", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState(put(local, "target", "target-v1"));
    expect(
      store.updatePersistedAtomState({
        ...promotion(),
        expectedTarget: { draftId: "target", scopeVersion: "target-v1" },
      }),
    ).toMatchObject({ outcome: "conflict", reason: "target_conflict" });
    expect(entry(store)).toMatchObject(identity);
    expect(entry(store, local)).toMatchObject({ draftId: "target" });
  });

  it("adds canonical thread metadata after promotion, preserving a reused Home binding", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState(promotion());
    store.updatePersistedAtomState(
      put(home, "new-home", "new-version", null, "new Home"),
    );
    expect(
      store.updatePersistedAtomState({
        ...promotion(),
        threadId: "canonical-thread-1",
      }),
    ).toMatchObject({ outcome: "applied", changed: true });
    expect(entry(store, local)).toMatchObject({
      ...identity,
      sessionId: "session-1",
      threadId: "canonical-thread-1",
    });
    expect(entry(store)).toMatchObject({
      draftId: "new-home",
      draft: { text: "new Home" },
    });
    expect(
      store.updatePersistedAtomState({
        ...promotion(local, local),
        expectedTarget: identity,
        threadId: "other-thread",
      }),
    ).toMatchObject({ outcome: "conflict", reason: "identity_mismatch" });
  });

  it("rejects a promotion with mismatched session metadata or stale source version", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    expect(
      store.updatePersistedAtomState({
        ...promotion(),
        sessionId: "canonical-thread",
      }),
    ).toMatchObject({ outcome: "conflict", reason: "identity_mismatch" });
    expect(
      store.updatePersistedAtomState({
        ...promotion(),
        identity: { ...identity, scopeVersion: "wrong" },
      }),
    ).toMatchObject({ outcome: "conflict", reason: "version_conflict" });
    expect(entry(store)).toMatchObject(identity);
    expect(entry(store, local)).toBeNull();
  });

  it("consumes the exact promoted token, releases its binding and drops all payload", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState(promotion());
    const result = store.updatePersistedAtomState({ op: "consume", identity });
    expect(result).toMatchObject({
      outcome: "applied",
      changed: true,
      entry: { ...identity, state: "consumed", consumption: "accepted" },
    });
    expect(result.entry).not.toHaveProperty("draft");
    expect(entry(store, local)).toBeNull();
    expect(
      store.updatePersistedAtomState({ op: "consume", identity }),
    ).toMatchObject({
      outcome: "applied",
      changed: false,
      storeRevision: 3,
    });
    expect(store.updatePersistedAtomState(put())).toMatchObject({
      outcome: "conflict",
      reason: "retired_draft",
      storeRevision: 3,
    });
    expect(
      store.updatePersistedAtomState(
        put(local, "d1", "late", "v1", "late write"),
      ),
    ).toMatchObject({ outcome: "conflict", reason: "retired_draft" });
  });

  it("accepted/clear of an old version leaves newer same-scope edits untouched", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState(
      put(home, "d1", "v2", "v1", "edited after send"),
    );
    for (const op of ["consume", "clear"])
      expect(store.updatePersistedAtomState({ op, identity })).toMatchObject({
        outcome: "conflict",
        changed: false,
        reason: "version_conflict",
      });
    expect(entry(store)).toMatchObject({
      scopeVersion: "v2",
      draft: { text: "edited after send" },
    });
  });

  it("old accepted replay cannot clear a newly reused Home draft id", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState({ op: "consume", identity });
    store.updatePersistedAtomState(
      put(home, "new-home", "new-version", null, "next draft"),
    );
    expect(
      store.updatePersistedAtomState({ op: "consume", identity }),
    ).toMatchObject({
      outcome: "applied",
      changed: false,
    });
    expect(entry(store)).toMatchObject({
      draftId: "new-home",
      draft: { text: "next draft" },
    });
  });

  it("explicit clear creates the same non-resurrectable minimal tombstone", async () => {
    const { store } = await createStore();
    store.updatePersistedAtomState(put());
    expect(
      store.updatePersistedAtomState({ op: "clear", identity }),
    ).toMatchObject({
      outcome: "applied",
      entry: { state: "consumed", consumption: "clear" },
    });
    expect(store.updatePersistedAtomState(put())).toMatchObject({
      outcome: "conflict",
      reason: "retired_draft",
    });
  });

  it("does not evict tombstones when the entry budget is full", async () => {
    const { store } = await createStore({
      limits: { ...limits, maxEntries: 1 },
    });
    store.updatePersistedAtomState(put());
    store.updatePersistedAtomState({ op: "consume", identity });
    expect(
      store.updatePersistedAtomState(put(home, "new-home", "new-version")),
    ).toMatchObject({
      outcome: "invalid",
      reason: "capacity_exceeded",
      storeRevision: 2,
    });
    expect(store.updatePersistedAtomState(put())).toMatchObject({
      outcome: "conflict",
      reason: "retired_draft",
    });
    expect(
      store.updatePersistedAtomState({ op: "consume", identity }),
    ).toMatchObject({
      outcome: "applied",
      changed: false,
    });
  });

  it("enforces draft UTF8 and aggregate file budgets without changing an old draft", async () => {
    const { store } = await createStore({
      limits: { ...limits, maxDraftBytes: 800, maxFileBytes: 1_500 },
    });
    expect(
      store.updatePersistedAtomState(put(home, "d1", "v1", null, "x")),
    ).toMatchObject({
      outcome: "applied",
    });
    const before = entry(store);
    expect(
      store.updatePersistedAtomState(
        put(home, "d1", "v2", "v1", "中文".repeat(200)),
      ),
    ).toMatchObject({ outcome: "invalid", reason: "capacity_exceeded" });
    expect(entry(store)).toEqual(before);
    expect(
      store.updatePersistedAtomState(
        put(local, "d2", "v-other", null, "中文".repeat(25)),
      ),
    ).toMatchObject({ outcome: "invalid", reason: "capacity_exceeded" });
    expect(entry(store, local)).toBeNull();
    expect(entry(store)).toEqual(before);
  });

  it("input/read/result objects cannot mutate the Main-owned record", async () => {
    const { store } = await createStore();
    const input = put(),
      result = store.updatePersistedAtomState(input);
    if (input.op === "put")
      (input.draft as { text: string }).text = "external mutation";
    const read = entry(store);
    if (read?.state === "draft")
      (read.draft as { text: string }).text = "read mutation";
    if (result.entry?.state === "draft")
      (result.entry.draft as { text: string }).text = "result mutation";
    expect(entry(store)).toMatchObject({ draft: { text: "rich 中文😀" } });
  });

  it("notification failures cannot roll back a committed record and events contain no draft", async () => {
    const { store } = await createStore(),
      events: PersistedAtomMetadata[] = [];
    store.subscribe(() => {
      throw new Error("listener failure");
    });
    store.subscribe((event) => events.push(event));
    expect(store.updatePersistedAtomState(put())).toMatchObject({
      outcome: "applied",
    });
    expect(events.map((event) => event.key)).toEqual([
      "composer-drafts-v1",
      "local-env-selections-by-workspace",
      "local-env-recent-actions-by-key",
      "app-shell-summary-panel-pinned",
      "app-shell-file-tree-open",
    ]);
    for (const event of events) {
      expect(event).not.toHaveProperty("entry");
      expect(event).not.toHaveProperty("draft");
      expect(event).not.toHaveProperty("value");
      expect(event).not.toHaveProperty("selections");
    }
    expect(JSON.stringify(events)).not.toContain("rich 中文");
  });

  it("invalid/accessor requests have no side effects or getter execution", async () => {
    const { store } = await createStore();
    let called = false;
    const request = Object.defineProperty({}, "op", {
      enumerable: true,
      get() {
        called = true;
        return "consume";
      },
    });
    expect(store.updatePersistedAtomState(request)).toMatchObject({
      outcome: "invalid",
      changed: false,
      storeRevision: 0,
    });
    expect(called).toBe(false);
    expect(
      store.updatePersistedAtomState({ op: "replace", data: {} }),
    ).toMatchObject({
      outcome: "invalid",
      storeRevision: 0,
    });
  });
});
