import { beforeEach, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY as key } from "./persistedAtomTypes";
import {
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "./persistedAtoms";
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
const metadata = {
  key,
  storeRevision: 1,
  persistence: { state: "saved", savedRevision: 1 },
};
beforeEach(() => vi.resetAllMocks());
it("uses the existing Host commands with a typed per-environment mutation", async () => {
  const read = { key, query: { kind: "recent-actions" } } as const;
  vi.mocked(safeInvoke).mockResolvedValueOnce({
    ...metadata,
    outcome: "ready",
    data: { queryKind: "recent-actions", recentActions: { "/repo": ["Test"] } },
  });
  await expect(sendPersistedAtomState(read)).resolves.toMatchObject({
    data: { recentActions: { "/repo": ["Test"] } },
  });
  const update = {
    key,
    mutation: { op: "record", environmentKey: "/repo", actionName: "Build" },
  } as const;
  vi.mocked(safeInvoke).mockResolvedValueOnce({
    ...metadata,
    outcome: "applied",
    changed: true,
    entry: null,
    recentActions: { "/repo": ["Build", "Test"] },
  });
  await expect(updatePersistedAtomState(update)).resolves.toMatchObject({
    recentActions: { "/repo": ["Build", "Test"] },
  });
  expect(safeInvoke).toHaveBeenNthCalledWith(1, "persisted_atom_read", read);
  expect(safeInvoke).toHaveBeenNthCalledWith(
    2,
    "persisted_atom_update",
    update,
  );
});
it("rejects malformed writes before IPC and unrelated applied receipts", async () => {
  await expect(
    updatePersistedAtomState({
      key,
      mutation: { op: "record", environmentKey: "/repo", actionName: "  " },
    }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(safeInvoke).not.toHaveBeenCalled();
  vi.mocked(safeInvoke).mockResolvedValueOnce({
    ...metadata,
    outcome: "applied",
    changed: true,
    entry: null,
    recentActions: { "/other": ["Test"] },
  });
  await expect(
    updatePersistedAtomState({
      key,
      mutation: { op: "record", environmentKey: "/repo", actionName: "Test" },
    }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
