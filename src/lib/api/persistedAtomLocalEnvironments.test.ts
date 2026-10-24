import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY as key } from "./persistedAtomTypes";
import {
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "./persistedAtoms";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
const workspaceKey = "local:/workspace/project";
const configPath = "/workspace/project/.codex/environments/environment.toml";
const metadata = {
  key,
  storeRevision: 1,
  persistence: { state: "saved", savedRevision: 1 },
};
beforeEach(() => vi.resetAllMocks());

describe("environment selection typed gateway (explicit fake bridge unit evidence)", () => {
  it("reads and mutates one workspace through the existing Host IPC commands", async () => {
    const read = { key, query: { kind: "selections" } } as const;
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      ...metadata,
      outcome: "ready",
      data: { queryKind: "selections", selections: {} },
    });
    await expect(sendPersistedAtomState(read)).resolves.toMatchObject({
      data: { selections: {} },
    });
    const update = {
      key,
      mutation: { op: "set", workspaceKey, configPath: null },
    } as const;
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      ...metadata,
      outcome: "applied",
      changed: true,
      entry: null,
      selections: { [workspaceKey]: null },
    });
    await expect(updatePersistedAtomState(update)).resolves.toMatchObject({
      selections: { [workspaceKey]: null },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(1, "persisted_atom_read", read);
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "persisted_atom_update",
      update,
    );
  });

  it("rejects malformed selection writes before IPC and foreign applied receipts after IPC", async () => {
    await expect(
      updatePersistedAtomState({
        key,
        mutation: { op: "set", workspaceKey, configPath: "relative.toml" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(safeInvoke).not.toHaveBeenCalled();
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      ...metadata,
      outcome: "applied",
      changed: true,
      entry: null,
      selections: { [workspaceKey]: configPath },
    });
    await expect(
      updatePersistedAtomState({
        key,
        mutation: { op: "set", workspaceKey, configPath: null },
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
