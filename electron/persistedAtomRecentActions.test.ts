import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistedAtomHost } from "./persistedAtomHost";
import { PersistedAtomStore } from "./persistedAtomStore";
import {
  cleanup,
  createRoot,
  createStore,
  limits,
  put,
  trackStore,
} from "./persistedAtomStore.test-support";
import { LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY as key } from "../src/lib/api/persistedAtomTypes";
import {
  parsePersistedAtomReadResult,
  parsePersistedAtomUpdateResult,
} from "../src/lib/api/persistedAtomProtocol";
import {
  parseLocalEnvironmentRecentActions,
  parseLocalEnvironmentRecentActionMutation,
} from "../src/lib/api/localEnvironmentRecentActionsProtocol";

afterEach(cleanup);
const read = { key, query: { kind: "recent-actions" } } as const;
const record = (environmentKey: string, actionName: string) => ({
  op: "record" as const,
  environmentKey,
  actionName,
});

describe("recent environment actions in the single Host atom store", () => {
  it("merges concurrent scopes, deduplicates names and restores with drafts after cold restart", async () => {
    const { root, store } = await createStore();
    store.updatePersistedAtomState(put());
    store.recordLocalEnvironmentAction(record("/repo/app", " Test "));
    const saving = store.flush();
    await Promise.all([
      Promise.resolve().then(() =>
        store.recordLocalEnvironmentAction(record("/other/app", "Run")),
      ),
      Promise.resolve().then(() =>
        store.recordLocalEnvironmentAction(record("/repo/app", "Build")),
      ),
    ]);
    const result = store.recordLocalEnvironmentAction(
      record("/repo/app", "Test"),
    );
    expect(
      parsePersistedAtomUpdateResult(result, {
        key,
        mutation: record("/repo/app", "Test"),
      }),
    ).toMatchObject({
      outcome: "applied",
      changed: true,
      recentActions: { "/repo/app": ["Test", "Build"], "/other/app": ["Run"] },
    });
    expect(
      store.recordLocalEnvironmentAction(record("/repo/app", "Test")),
    ).toMatchObject({ changed: false, storeRevision: result.storeRevision });
    await saving;
    await store.flush();
    const restored = new PersistedAtomStore(root, { limits });
    trackStore(restored);
    await restored.ready;
    expect(
      parsePersistedAtomReadResult(
        restored.sendLocalEnvironmentRecentActions(),
        read,
      ),
    ).toMatchObject({
      outcome: "ready",
      storeRevision: result.storeRevision,
      persistence: { state: "saved" },
      data: { recentActions: result.recentActions },
    });
    expect(
      restored.sendPersistedAtomState({
        kind: "scope",
        scope: { workspaceId: null, kind: "home", id: "new-conversation" },
      }),
    ).toMatchObject({ data: { view: { entry: { draftId: "d1" } } } });
  });

  it("rejects capacity and malformed mutations without overwriting accepted history", async () => {
    const root = await createRoot();
    const store = new PersistedAtomStore(root, {
      limits: { ...limits, maxBindings: 1 },
    });
    trackStore(store);
    await store.ready;
    store.recordLocalEnvironmentAction(record("/repo", "Test"));
    expect(
      store.recordLocalEnvironmentAction(record("/other", "Run")),
    ).toMatchObject({
      outcome: "invalid",
      reason: "capacity_exceeded",
      changed: false,
    });
    expect(
      store.recordLocalEnvironmentAction(record("/repo", "Build")),
    ).toMatchObject({ outcome: "invalid", reason: "capacity_exceeded" });
    expect(
      store.recordLocalEnvironmentAction({
        ...record("/repo", "Run"),
        extra: true,
      }),
    ).toMatchObject({ outcome: "invalid", reason: "invalid_request" });
    expect(store.sendLocalEnvironmentRecentActions()).toMatchObject({
      storeRevision: 1,
      data: { recentActions: { "/repo": ["Test"] } },
    });
  });

  it("uses current Host read/update contracts and metadata-only events", async () => {
    const root = await createRoot();
    const events: unknown[] = [];
    const host = new PersistedAtomHost(root, (event, payload) =>
      events.push({ event, payload }),
    );
    try {
      await host.ready;
      const mutation = record("/repo", "Build");
      expect(
        parsePersistedAtomUpdateResult(
          host.updatePersistedAtomState({ key, mutation }),
          { key, mutation },
        ),
      ).toMatchObject({
        outcome: "applied",
        recentActions: { "/repo": ["Build"] },
      });
      expect(
        parsePersistedAtomReadResult(host.sendPersistedAtomState(read), read),
      ).toMatchObject({ data: { recentActions: { "/repo": ["Build"] } } });
      expect(events).toContainEqual({
        event: "persisted-atom-update",
        payload: expect.objectContaining({ key, storeRevision: 1 }),
      });
      expect(JSON.stringify(events)).not.toContain("Build");
      expect(
        host.sendPersistedAtomState({ key, query: { kind: "selections" } }),
      ).toMatchObject({ outcome: "invalid" });
      await vi.waitFor(() =>
        expect(host.sendPersistedAtomState(read)).toMatchObject({
          persistence: { state: "saved", savedRevision: 1 },
        }),
      );
    } finally {
      host.dispose();
    }
  });

  it("rejects hostile shapes and foreign applied receipts", () => {
    for (const value of [
      null,
      [],
      { "/repo": "Test" },
      { "/repo": [null] },
      { "/repo": Array(2) },
    ])
      expect(() => parseLocalEnvironmentRecentActions(value, 20)).toThrow();
    expect(() =>
      parseLocalEnvironmentRecentActionMutation(record("/repo", "  ")),
    ).toThrow();
    const mutation = record("/repo", "Build");
    expect(() =>
      parsePersistedAtomUpdateResult(
        {
          key,
          storeRevision: 1,
          persistence: { state: "saved", savedRevision: 1 },
          outcome: "applied",
          changed: true,
          entry: null,
          recentActions: { "/other": ["Build"] },
        },
        { key, mutation },
      ),
    ).toThrow();
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "relative/path",
    "C:relative",
    "/repo\u0000",
    "/repo\u001f",
    "/repo\u007f",
  ])(
    "rejects non-path or control-character environment keys: %j",
    (environmentKey) => {
      expect(() =>
        parseLocalEnvironmentRecentActions({ [environmentKey]: ["Build"] }, 20),
      ).toThrow();
      expect(() =>
        parseLocalEnvironmentRecentActionMutation(
          record(environmentKey, "Build"),
        ),
      ).toThrow();
    },
  );

  it.each([
    "/repo/app",
    "C:\\repo\\app",
    "d:/repo/app",
    "\\\\server\\share\\app",
  ])(
    "accepts absolute environment paths across platforms: %s",
    (environmentKey) => {
      expect(
        parseLocalEnvironmentRecentActionMutation(
          record(environmentKey, " Build "),
        ),
      ).toEqual(record(environmentKey, "Build"));
      expect(
        parseLocalEnvironmentRecentActions({ [environmentKey]: ["Build"] }, 20),
      ).toEqual({
        [environmentKey]: ["Build"],
      });
    },
  );

  it("rejects accessors without evaluating private or hostile values", () => {
    const getter = vi.fn(() => "Build");
    const names = Object.defineProperty(["Build"], "0", {
      get: getter,
      enumerable: true,
    });
    const mutation = Object.defineProperty(
      record("/repo", "Build"),
      "actionName",
      {
        get: getter,
        enumerable: true,
      },
    );
    const map = Object.defineProperty({}, "/repo", {
      get: getter,
      enumerable: true,
    });
    expect(() =>
      parseLocalEnvironmentRecentActions({ "/repo": names }, 20),
    ).toThrow();
    expect(() => parseLocalEnvironmentRecentActions(map, 20)).toThrow();
    expect(() => parseLocalEnvironmentRecentActionMutation(mutation)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
