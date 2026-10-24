import { describe, expect, it } from "vitest";
import {
  parseLocalEnvironmentSelectionMutation,
  parseLocalEnvironmentSelections,
} from "./localEnvironmentSelectionProtocol";
import {
  parsePersistedAtomReadRequest,
  parsePersistedAtomReadResult,
  parsePersistedAtomUpdateEvent,
  parsePersistedAtomUpdateResult,
} from "./persistedAtomProtocol";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY as key } from "./persistedAtomTypes";

const workspaceKey = "local:/workspace/project";
const configPath = "/workspace/project/.codex/environments/environment.toml";
const metadata = {
  key,
  storeRevision: 2,
  persistence: { state: "saved", savedRevision: 2 },
} as const;
const read = { key, query: { kind: "selections" } } as const;

describe("local environment selection transport", () => {
  it("distinguishes missing and null while retaining host and path identity", () => {
    const selections = parseLocalEnvironmentSelections(
      {
        [workspaceKey]: null,
        "remote:/workspace/project": configPath,
        "local:C:/Workspace": "C:\\Workspace\\.codex\\environment.toml",
        "local://server/share/project": "\\\\server\\share\\environment.toml",
      },
      4,
    );
    expect(Object.hasOwn(selections, "local:/missing")).toBe(false);
    expect(selections[workspaceKey]).toBeNull();
    expect(selections["remote:/workspace/project"]).toBe(configPath);
    expect(
      parsePersistedAtomReadResult(
        {
          ...metadata,
          outcome: "ready",
          data: { queryKind: "selections", selections },
        },
        parsePersistedAtomReadRequest(read),
      ),
    ).toMatchObject({ data: { selections } });
  });

  it.each([
    { op: "set", workspaceKey, configPath: "relative.toml" },
    { op: "set", workspaceKey: "missing-host", configPath },
    { op: "set", workspaceKey, configPath: "C:relative.toml" },
    { op: "set", workspaceKey, configPath: `${configPath}\nprivate` },
    { op: "set", workspaceKey, configPath, path: "/foreign" },
    { op: "delete", workspaceKey, configPath: null },
    { op: "replace", selections: { [workspaceKey]: configPath } },
  ])("rejects malformed or replacement mutation %#", (value) => {
    expect(() => parseLocalEnvironmentSelectionMutation(value)).toThrow();
  });

  it("rejects accessors, inherited objects, capacity overflow and malformed maps", () => {
    let accessed = false;
    const accessor = Object.defineProperty({}, workspaceKey, {
      enumerable: true,
      get() {
        accessed = true;
        return configPath;
      },
    });
    for (const value of [
      accessor,
      Object.create({ [workspaceKey]: configPath }),
      { [workspaceKey]: false },
      { [workspaceKey]: "relative.toml" },
      { "missing-host": null },
      [],
    ])
      expect(() => parseLocalEnvironmentSelections(value, 10)).toThrow();
    expect(accessed).toBe(false);
    expect(() =>
      parseLocalEnvironmentSelections(
        { [workspaceKey]: configPath, "local:/second": null },
        1,
      ),
    ).toThrow();
  });

  it("verifies the exact mutation receipt and rejects cross-atom projections", () => {
    const update = {
      key,
      mutation: { op: "set", workspaceKey, configPath: null },
    } as const;
    const receipt = {
      ...metadata,
      outcome: "applied",
      changed: true,
      entry: null,
      selections: { [workspaceKey]: null },
    };
    expect(parsePersistedAtomUpdateResult(receipt, update)).toEqual(receipt);
    for (const selections of [{}, { [workspaceKey]: configPath }])
      expect(() =>
        parsePersistedAtomUpdateResult({ ...receipt, selections }, update),
      ).toThrow();
    expect(() =>
      parsePersistedAtomUpdateResult(receipt, {
        key,
        mutation: { op: "delete", workspaceKey },
      }),
    ).toThrow();
    expect(() =>
      parsePersistedAtomReadResult(
        {
          ...metadata,
          outcome: "ready",
          data: { queryKind: "value", value: true },
        },
        read,
      ),
    ).toThrow();
    expect(() =>
      parsePersistedAtomReadResult({
        ...metadata,
        key: "composer-drafts-v1",
        outcome: "ready",
        data: { queryKind: "selections", selections: {} },
      }),
    ).toThrow();
    expect(() =>
      parsePersistedAtomUpdateResult({ ...receipt, value: false }),
    ).toThrow();
    expect(
      parsePersistedAtomUpdateEvent({
        ...metadata,
        event: "persisted-atom-update",
      }),
    ).toMatchObject({ key, storeRevision: 2 });
    expect(() =>
      parsePersistedAtomUpdateEvent({
        ...metadata,
        event: "persisted-atom-update",
        selections: receipt.selections,
      }),
    ).toThrow();
  });
});
