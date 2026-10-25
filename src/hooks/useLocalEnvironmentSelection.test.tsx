import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocalEnvironmentSelection } from "./useLocalEnvironmentSelection";
import type {
  PersistedAtomReadResult,
  PersistedAtomUpdateEvent,
} from "@/lib/api/persistedAtomTypes";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY as key } from "@/lib/api/persistedAtomTypes";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@/lib/api/persistedAtoms", () => ({
  sendPersistedAtomState: mocks.read,
  updatePersistedAtomState: mocks.update,
  listenPersistedAtomUpdates: mocks.listen,
}));
vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: { list: mocks.list },
}));
const configPath = "/a/.lime/environments/environment.toml";
const entry = {
  type: "success",
  configPath,
  cwdRelativeToGitRoot: ".",
  environment: { version: 1, name: "Dev", setup: { script: "" }, actions: [] },
};
const ready = (
  revision: number,
  selections: Record<string, string | null>,
): PersistedAtomReadResult => ({
  key,
  storeRevision: revision,
  persistence: { state: "saved", savedRevision: revision },
  outcome: "ready",
  data: { queryKind: "selections", selections },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let root: Root,
  container: HTMLDivElement,
  value: ReturnType<typeof useLocalEnvironmentSelection>,
  event: (event: PersistedAtomUpdateEvent) => void;
function Probe({ workspaceRoot }: { workspaceRoot: string }) {
  value = useLocalEnvironmentSelection({ workspaceRoot });
  return <output>{value.resolvedConfigPath}</output>;
}
async function render(workspaceRoot = "/a") {
  await act(async () => root.render(<Probe workspaceRoot={workspaceRoot} />));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.listen.mockImplementation(async (handler) => {
    event = handler;
    return mocks.stop;
  });
  mocks.read.mockResolvedValue(ready(1, { "local:/a": configPath }));
  mocks.list.mockResolvedValue({ environments: [entry] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("projects the canonical choice, retains it while refreshing, and ignores other atom notifications", async () => {
  await render();
  expect(value.resolvedConfigPath).toBe(configPath);
  const pending = deferred<{ environments: (typeof entry)[] }>();
  mocks.list.mockReturnValueOnce(pending.promise);
  await act(async () => value.reload());
  expect(value.isLoading).toBe(true);
  expect(value.resolvedConfigPath).toBe(configPath);
  const reads = mocks.read.mock.calls.length;
  await act(async () =>
    event({
      key: "composer-drafts-v1",
      storeRevision: 7,
      persistence: { state: "saved", savedRevision: 7 },
    }),
  );
  expect(mocks.read).toHaveBeenCalledTimes(reads);
  await act(async () => pending.resolve({ environments: [entry] }));
  expect(value.isLoading).toBe(false);
});
it("does not let late reads or writes move a different workspace's selection", async () => {
  const pending = deferred<PersistedAtomReadResult>();
  mocks.read.mockReturnValueOnce(pending.promise);
  await render();
  mocks.read.mockResolvedValue(ready(2, { "local:/b": null }));
  await render("/b");
  await act(async () => pending.resolve(ready(99, { "local:/a": configPath })));
  expect(value.workspaceKey).toBe("local:/b");
  expect(value.resolvedConfigPath).toBeNull();
  expect(mocks.stop).toHaveBeenCalled();
});
it("serializes updates and keeps Host memory authoritative when disk persistence fails", async () => {
  await render();
  const pending = deferred<unknown>();
  mocks.update.mockReturnValueOnce(pending.promise);
  let first!: Promise<boolean>;
  let duplicate!: Promise<boolean>;
  await act(async () => {
    first = value.updateSelection(null);
    duplicate = value.updateSelection(configPath);
  });
  expect(await duplicate).toBe(false);
  expect(mocks.update).toHaveBeenCalledOnce();
  await act(async () =>
    pending.resolve({
      key,
      outcome: "applied",
      entry: null,
      selections: { "local:/a": null },
      storeRevision: 2,
      persistence: { state: "error", savedRevision: 1 },
    }),
  );
  expect(await first).toBe(false);
  expect(value.resolvedConfigPath).toBeNull();
  expect(value.error).toBe(true);
});
it("retains the choice on rejected updates and reports a failed initial load without an endless spinner", async () => {
  await render();
  mocks.update.mockRejectedValueOnce(Error("unavailable"));
  await act(async () => {
    expect(await value.updateSelection(null)).toBe(false);
  });
  expect(value.resolvedConfigPath).toBe(configPath);
  mocks.read.mockRejectedValueOnce(Error("unavailable"));
  await render("/b");
  expect(value.error).toBe(true);
  expect(value.isLoading).toBe(false);
});

it("keeps the loaded choice on refresh failures and rejects an older Host snapshot after reload", async () => {
  await render();
  mocks.read.mockRejectedValueOnce(Error("offline"));
  mocks.list.mockRejectedValueOnce(Error("offline"));
  await act(async () => value.reload());
  expect(value.ready).toBe(true);
  expect(value.resolvedConfigPath).toBe(configPath);
  expect(value.error).toBe(true);
  expect(value.isLoading).toBe(false);
  mocks.read.mockResolvedValueOnce(ready(0, { "local:/a": null }));
  await act(async () => value.reload());
  expect(value.resolvedConfigPath).toBe(configPath);
  mocks.read.mockResolvedValueOnce(ready(2, { "local:/a": null }));
  await act(async () =>
    event({
      key,
      storeRevision: 2,
      persistence: { state: "saved", savedRevision: 2 },
    }),
  );
  expect(value.resolvedConfigPath).toBeNull();
});

it("does not apply a late write after switching workspaces", async () => {
  await render();
  const pending = deferred<unknown>();
  mocks.update.mockReturnValueOnce(pending.promise);
  let update!: Promise<boolean>;
  await act(async () => {
    update = value.updateSelection(null);
  });
  mocks.read.mockResolvedValue(ready(3, { "local:/b": configPath }));
  await render("/b");
  await act(async () =>
    pending.resolve({
      key,
      outcome: "applied",
      entry: null,
      selections: { "local:/a": null },
      storeRevision: 4,
      persistence: { state: "saved", savedRevision: 4 },
    }),
  );
  expect(await update).toBe(false);
  expect(value.workspaceKey).toBe("local:/b");
  expect(value.savedConfigPath).toBe(configPath);
  expect(value.updating).toBe(false);
});
