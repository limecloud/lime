import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocalEnvironmentRecentActions } from "./useLocalEnvironmentRecentActions";
import {
  LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY as key,
  type PersistedAtomUpdateEvent,
} from "@/lib/api/persistedAtomTypes";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@/lib/api/persistedAtoms", () => ({
  sendPersistedAtomState: mocks.read,
  updatePersistedAtomState: mocks.update,
  listenPersistedAtomUpdates: mocks.listen,
}));
const ready = (
  storeRevision: number,
  recentActions: Record<string, string[]>,
) => ({
  key,
  storeRevision,
  persistence: { state: "saved", savedRevision: storeRevision },
  outcome: "ready",
  data: { queryKind: "recent-actions", recentActions },
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
  value: ReturnType<typeof useLocalEnvironmentRecentActions>,
  event: (event: PersistedAtomUpdateEvent) => void;
function Probe({ scope }: { scope: string | null }) {
  value = useLocalEnvironmentRecentActions(scope);
  return <output>{value.recentNames.join(",")}</output>;
}
async function render(scope: string | null = "/a") {
  await act(async () => root.render(<Probe scope={scope} />));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.listen.mockImplementation(async (handler) => {
    event = handler;
    return mocks.stop;
  });
  mocks.read.mockResolvedValue(ready(1, { "/a": ["Test"], "/b": ["Build"] }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("projects only the active environment and refreshes on matching Host events", async () => {
  await render();
  expect(value.recentNames).toEqual(["Test"]);
  const count = mocks.read.mock.calls.length;
  await act(async () =>
    event({
      key: "composer-drafts-v1",
      storeRevision: 2,
      persistence: { state: "saved", savedRevision: 2 },
    }),
  );
  expect(mocks.read).toHaveBeenCalledTimes(count);
  mocks.read.mockResolvedValue(ready(2, { "/a": ["Build", "Test"] }));
  await act(async () =>
    event({
      key,
      storeRevision: 2,
      persistence: { state: "saved", savedRevision: 2 },
    }),
  );
  expect(value.recentNames).toEqual(["Build", "Test"]);
  await render(null);
  expect(value.recentNames).toEqual([]);
  expect(mocks.stop).toHaveBeenCalled();
});
it("rejects late reads and update receipts from a previous environment", async () => {
  const read = deferred<ReturnType<typeof ready>>();
  mocks.read.mockReturnValueOnce(read.promise);
  await render();
  const write = deferred<unknown>();
  mocks.update.mockReturnValueOnce(write.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = value.recordAction("Test");
  });
  await render("/b");
  expect(value.recentNames).toEqual(["Build"]);
  await act(async () => {
    read.resolve(ready(99, { "/a": ["Late"] }));
    write.resolve({
      key,
      storeRevision: 100,
      outcome: "applied",
      recentActions: { "/a": ["Late"] },
      persistence: { state: "saved" },
    });
    await pending;
  });
  expect(value.recentNames).toEqual(["Build"]);
});
it("does not let an earlier read replace the latest write and retains history on failures", async () => {
  await render();
  const pending = deferred<ReturnType<typeof ready>>();
  mocks.read.mockReturnValueOnce(pending.promise);
  await act(async () =>
    event({
      key,
      storeRevision: 1,
      persistence: { state: "saved", savedRevision: 1 },
    }),
  );
  mocks.update.mockResolvedValueOnce({
    key,
    storeRevision: 3,
    outcome: "applied",
    recentActions: { "/a": ["Build", "Test"] },
    persistence: { state: "saved" },
  });
  await act(async () => value.recordAction(" Build "));
  expect(mocks.update).toHaveBeenCalledWith({
    key,
    mutation: { op: "record", environmentKey: "/a", actionName: "Build" },
  });
  await act(async () => pending.resolve(ready(2, { "/a": ["Old"] })));
  expect(value.recentNames).toEqual(["Build", "Test"]);
  mocks.update.mockRejectedValueOnce(Error("offline"));
  await act(async () => value.recordAction("Fail"));
  expect(value.recentNames).toEqual(["Build", "Test"]);
  expect(value.error).toBe(true);
});
