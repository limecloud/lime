import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY as key } from "../src/lib/api/persistedAtomTypes";
import {
  parsePersistedAtomReadResult,
  parsePersistedAtomUpdateResult,
} from "../src/lib/api/persistedAtomProtocol";
import { PersistedAtomHost } from "./persistedAtomHost";
import { PersistedAtomStore } from "./persistedAtomStore";
import { persistedAtomFileIO } from "./persistedAtomFile";
import {
  cleanup,
  createRoot,
  createStore,
  entry,
  limits,
  put,
  trackStore,
} from "./persistedAtomStore.test-support";

afterEach(cleanup);
const workspaceKey = "local:/workspace/project";
const configPath = "/workspace/project/.lime/environments/environment.toml";
const read = { key, query: { kind: "selections" } } as const;
const set = (workspaceKey: string, configPath: string | null) => ({
  op: "set" as const,
  workspaceKey,
  configPath,
});

describe("local environment selection in the existing persisted atom owner", () => {
  it("keeps independent concurrent workspace changes through queued save and cold restart", async () => {
    const { root, store } = await createStore();
    expect(store.sendLocalEnvironmentSelections()).toMatchObject({
      outcome: "ready",
      data: { selections: {} },
    });
    expect(store.updatePersistedAtomState(put()).outcome).toBe("applied");
    const first = store.updateLocalEnvironmentSelection(
      set(workspaceKey, null),
    );
    const saving = store.flush();
    const [second, third] = await Promise.all([
      Promise.resolve().then(() =>
        store.updateLocalEnvironmentSelection(
          set("remote:/workspace/project", configPath),
        ),
      ),
      Promise.resolve().then(() =>
        store.updateLocalEnvironmentSelection(
          set("local:/workspace/another", configPath),
        ),
      ),
    ]);
    expect([first, second, third].map((receipt) => receipt.outcome)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    await saving;
    await store.flush();
    const restored = new PersistedAtomStore(root, { limits });
    trackStore(restored);
    await restored.ready;
    const state = parsePersistedAtomReadResult(
      restored.sendLocalEnvironmentSelections(),
      read,
    );
    expect(state).toMatchObject({
      storeRevision: 4,
      persistence: { state: "saved", savedRevision: 4 },
      data: {
        selections: {
          [workspaceKey]: null,
          "remote:/workspace/project": configPath,
          "local:/workspace/another": configPath,
        },
      },
    });
    if (state.outcome !== "ready" || state.data.queryKind !== "selections")
      throw new Error("expected selections");
    expect(Object.hasOwn(state.data.selections, "local:/missing")).toBe(false);
    expect(entry(restored)?.state).toBe("draft");
    expect(
      restored.sendBooleanState("app-shell-summary-panel-pinned"),
    ).toMatchObject({ data: { value: true } });
    expect(
      restored.updateLocalEnvironmentSelection(set(workspaceKey, null)),
    ).toMatchObject({ changed: false, storeRevision: 4 });
    expect(
      restored.updateLocalEnvironmentSelection({ op: "delete", workspaceKey }),
    ).toMatchObject({ changed: true, storeRevision: 5 });
    expect(restored.sendLocalEnvironmentSelections()).toMatchObject({
      data: { selections: { "remote:/workspace/project": configPath } },
    });
  });

  it("atomically clears same-host Windows aliases while preserving other hosts and POSIX casing", async () => {
    const root = await createRoot();
    const normalizedKey = "local:win32:/mnt/c/workspace/project";
    await writeFile(
      path.join(root, "host-state.json"),
      JSON.stringify({
        format: "electron-persisted-atom-state",
        version: 1,
        storeRevision: 5,
        atoms: {
          "composer-drafts-v1": { bindings: {}, entries: {} },
          [key]: {
            "local:C:/Workspace/Project": configPath,
            "local:c:/workspace/project": null,
            "local:\\\\?\\C:\\Workspace\\Project": configPath,
            "local:\\\\wsl$\\Ubuntu\\mnt\\c\\workspace\\project": null,
            "remote:C:/Workspace/Project": configPath,
            "local:/Workspace/Project": configPath,
          },
        },
      }),
    );
    const store = new PersistedAtomStore(root, { limits });
    trackStore(store);
    await store.ready;
    const revisions: number[] = [];
    store.subscribe((event) => {
      if (event.key === key) revisions.push(event.storeRevision);
    });
    const receipt = store.updateLocalEnvironmentSelection(
      set(normalizedKey, configPath),
    );
    expect(receipt).toMatchObject({
      changed: true,
      storeRevision: 6,
      selections: {
        [normalizedKey]: configPath,
        "remote:C:/Workspace/Project": configPath,
        "local:/Workspace/Project": configPath,
      },
    });
    expect(
      Object.hasOwn(receipt.selections!, "local:C:/Workspace/Project"),
    ).toBe(false);
    expect(Object.keys(receipt.selections!)).toHaveLength(3);
    expect(revisions).toEqual([6]);
    const deleted = store.updateLocalEnvironmentSelection({
      op: "delete",
      workspaceKey: "local:C:/WORKSPACE/PROJECT",
    });
    expect(deleted.storeRevision).toBe(7);
    expect(Object.hasOwn(deleted.selections!, normalizedKey)).toBe(false);
    expect(deleted.selections?.["remote:C:/Workspace/Project"]).toBe(
      configPath,
    );
    expect(deleted.selections?.["local:/Workspace/Project"]).toBe(configPath);
  });

  it("rejects malformed writes and shared budget overflow without losing accepted selections", async () => {
    const { store } = await createStore({
      limits: { ...limits, maxBindings: 1 },
    });
    expect(
      store.updateLocalEnvironmentSelection(set(workspaceKey, null)).outcome,
    ).toBe("applied");
    for (const mutation of [
      { ...set(workspaceKey, configPath), path: "/foreign" },
      set(workspaceKey, "relative.toml"),
      { op: "replace", selections: {} },
    ])
      expect(store.updateLocalEnvironmentSelection(mutation)).toMatchObject({
        outcome: "invalid",
        changed: false,
        reason: "invalid_request",
        storeRevision: 1,
      });
    expect(
      store.updateLocalEnvironmentSelection(set("local:/second", configPath)),
    ).toMatchObject({
      outcome: "invalid",
      reason: "capacity_exceeded",
      storeRevision: 1,
    });
    const { store: small } = await createStore({
      limits: { ...limits, maxFileBytes: 1_000 },
    });
    expect(
      small.updateLocalEnvironmentSelection(set(workspaceKey, null)).outcome,
    ).toBe("applied");
    expect(
      small.updateLocalEnvironmentSelection(
        set(workspaceKey, `/${"x".repeat(1000)}`),
      ),
    ).toMatchObject({
      outcome: "invalid",
      reason: "capacity_exceeded",
      storeRevision: 1,
    });
    expect(small.sendLocalEnvironmentSelections()).toMatchObject({
      data: { selections: { [workspaceKey]: null } },
    });
  });

  it("reports actual persistence failure and preserves the selection for retry", async () => {
    let fail = true;
    const { store } = await createStore({
      io: {
        ...persistedAtomFileIO,
        rename: async (from, to) => {
          if (fail)
            throw Object.assign(new Error("private details"), {
              code: "ENOSPC",
            });
          await persistedAtomFileIO.rename(from, to);
        },
      },
    });
    store.updateLocalEnvironmentSelection(set(workspaceKey, configPath));
    await store.flush();
    expect(store.sendLocalEnvironmentSelections()).toMatchObject({
      persistence: {
        state: "error",
        savedRevision: 0,
        diagnostic: { phase: "primary", code: "ENOSPC" },
      },
      data: { selections: { [workspaceKey]: configPath } },
    });
    fail = false;
    const savedEvents: number[] = [];
    store.subscribe((metadata) => {
      if (metadata.key === key) savedEvents.push(metadata.storeRevision);
    });
    expect(
      store.updateLocalEnvironmentSelection(set(workspaceKey, configPath)),
    ).toMatchObject({ outcome: "applied", changed: false, storeRevision: 1 });
    expect(savedEvents).toEqual([]);
    await vi.waitFor(
      () => {
        expect(store.sendLocalEnvironmentSelections()).toMatchObject({
          persistence: { state: "saved", savedRevision: 1 },
        });
      },
      { timeout: 5_000 },
    );
    expect(savedEvents).toEqual([1]);
    store.dispose();
    expect(
      store.updateLocalEnvironmentSelection(set(workspaceKey, null)),
    ).toMatchObject({
      outcome: "unavailable",
      reason: "closed",
      storeRevision: 1,
    });
  });

  it("loads through Host, emits metadata only, and fails closed on corrupt selection files", async () => {
    const root = await createRoot();
    const events: unknown[] = [];
    const host = new PersistedAtomHost(root, (_name, event) =>
      events.push(event),
    );
    try {
      await host.ready;
      const request = { key, mutation: set(workspaceKey, configPath) } as const;
      expect(
        parsePersistedAtomUpdateResult(
          host.updatePersistedAtomState(request),
          request,
        ),
      ).toMatchObject({
        outcome: "applied",
        selections: { [workspaceKey]: configPath },
      });
      expect(
        parsePersistedAtomReadResult(host.sendPersistedAtomState(read), read),
      ).toMatchObject({ data: { selections: { [workspaceKey]: configPath } } });
      for (const event of events.filter(
        (value) => (value as { key: string }).key === key,
      ))
        expect(Object.keys(event as object).sort()).toEqual([
          "event",
          "key",
          "persistence",
          "storeRevision",
        ]);
      await vi.waitFor(async () => {
        const saved = JSON.parse(
          await readFile(path.join(root, "host-state.json.bak"), "utf8"),
        );
        expect(saved.atoms[key]).toEqual({ [workspaceKey]: configPath });
      });
    } finally {
      host.dispose();
    }
    const corrupt = await createRoot();
    const raw = JSON.stringify({
      format: "electron-persisted-atom-state",
      version: 1,
      storeRevision: 1,
      atoms: {
        "composer-drafts-v1": { entries: {}, bindings: {} },
        [key]: { [workspaceKey]: false },
      },
    });
    for (const filename of ["host-state.json", "host-state.json.bak"])
      await writeFile(path.join(corrupt, filename), raw);
    const store = new PersistedAtomStore(corrupt, { limits });
    trackStore(store);
    await store.ready;
    expect(store.sendLocalEnvironmentSelections()).toMatchObject({
      outcome: "unavailable",
      persistence: {
        state: "unavailable",
        diagnostic: { code: "INVALID_STATE" },
      },
    });
    expect(await readFile(path.join(corrupt, "host-state.json"), "utf8")).toBe(
      raw,
    );
  });
});
