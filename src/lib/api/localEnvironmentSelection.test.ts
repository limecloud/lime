import { beforeEach, describe, expect, it, vi } from "vitest";
import { localEnvironments } from "./localEnvironments";
import {
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "./persistedAtoms";
import {
  readLocalEnvironmentSelection,
  selectLocalEnvironment,
} from "./localEnvironmentSelection";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY as key } from "./persistedAtomTypes";

vi.mock("./persistedAtoms", () => ({
  sendPersistedAtomState: vi.fn(),
  updatePersistedAtomState: vi.fn(),
}));
vi.mock("./localEnvironments", () => ({
  localEnvironments: { list: vi.fn() },
}));
const configPath = "/repo/.lime/environments/environment.toml";
const ready = (selections: Record<string, string | null>) =>
  ({
    key,
    outcome: "ready",
    storeRevision: 2,
    persistence: { state: "saved", savedRevision: 2 },
    data: { queryKind: "selections", selections },
  }) as const;
const entry = {
  type: "success" as const,
  configPath,
  cwdRelativeToGitRoot: ".",
  environment: { version: 1, name: "Dev", setup: { script: "" }, actions: [] },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendPersistedAtomState).mockResolvedValue(ready({}));
  vi.mocked(localEnvironments.list).mockResolvedValue({
    environments: [entry],
  });
});

describe("worktree local environment selection gateway", () => {
  it.each([{}, { "local:/repo": null }])(
    "does not choose a default for absent or explicit none: %j",
    async (selections) => {
      vi.mocked(sendPersistedAtomState).mockResolvedValue(ready(selections));
      expect(await readLocalEnvironmentSelection("/repo")).toBeNull();
      expect(localEnvironments.list).not.toHaveBeenCalled();
    },
  );
  it("validates a saved choice and sends only the canonical listed path", async () => {
    vi.mocked(sendPersistedAtomState).mockResolvedValue(
      ready({ "local:/repo": configPath }),
    );
    expect(await readLocalEnvironmentSelection("/repo")).toBe(configPath);
    expect(localEnvironments.list).toHaveBeenCalledExactlyOnceWith("/repo");
    vi.mocked(sendPersistedAtomState).mockResolvedValue(
      ready({ "local:/repo": "/repo/removed.toml" }),
    );
    expect(await readLocalEnvironmentSelection("/repo")).toBe(configPath);
  });
  it("fails before resource creation when a selected config is invalid or the Host is unavailable", async () => {
    vi.mocked(sendPersistedAtomState).mockResolvedValue(
      ready({ "local:/repo": configPath }),
    );
    vi.mocked(localEnvironments.list).mockResolvedValue({
      environments: [
        {
          type: "error",
          configPath,
          cwdRelativeToGitRoot: ".",
          error: { message: "bad TOML" },
        },
      ],
    });
    await expect(readLocalEnvironmentSelection("/repo")).rejects.toMatchObject({
      reason: "invalid",
      configPath,
    });
    vi.mocked(sendPersistedAtomState).mockResolvedValue({
      key,
      outcome: "unavailable",
      data: null,
      storeRevision: 0,
      persistence: { state: "unavailable", savedRevision: null },
    });
    await expect(readLocalEnvironmentSelection("/repo")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
  it("uses the existing typed single-workspace mutation and reports persistence failure", async () => {
    vi.mocked(updatePersistedAtomState).mockResolvedValue({
      key,
      outcome: "applied",
      entry: null,
      storeRevision: 3,
      selections: { "local:/repo": configPath },
      persistence: { state: "pending", savedRevision: 2 },
    });
    expect(await selectLocalEnvironment("/repo", configPath)).toBe(true);
    expect(updatePersistedAtomState).toHaveBeenCalledExactlyOnceWith({
      key,
      mutation: { op: "set", workspaceKey: "local:/repo", configPath },
    });
    vi.mocked(updatePersistedAtomState).mockResolvedValue({
      key,
      outcome: "applied",
      entry: null,
      storeRevision: 3,
      selections: { "local:/repo": configPath },
      persistence: { state: "error", savedRevision: 2 },
    });
    expect(await selectLocalEnvironment("/repo", configPath)).toBe(false);
  });
});
