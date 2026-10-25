import { describe, expect, it } from "vitest";
import type { LocalEnvironmentResult } from "../../packages/app-server-client/src/protocol";
import {
  areLocalEnvironmentPathsEqual,
  areLocalEnvironmentWorkspaceKeysEqual,
  getSavedLocalEnvironmentSelection,
  localEnvironmentWorkspaceKey,
  resolveLocalEnvironmentSelection,
} from "./localEnvironmentSelection";

const success = (configPath: string): LocalEnvironmentResult => ({
  type: "success",
  configPath,
  cwdRelativeToGitRoot: "",
  environment: {
    version: 1,
    name: configPath,
    setup: { script: "" },
    actions: [],
  },
});
const invalid = (configPath: string): LocalEnvironmentResult => ({
  type: "error",
  configPath,
  cwdRelativeToGitRoot: "",
  error: { message: "Invalid TOML" },
});
const root = "/workspace";
const key = localEnvironmentWorkspaceKey(root)!;
const defaultPath = `${root}/.lime/environments/environment.toml`;
const otherPath = `${root}/.lime/environments/environment-2.toml`;
const resolve = (
  options: Partial<Parameters<typeof resolveLocalEnvironmentSelection>[0]> = {},
) =>
  resolveLocalEnvironmentSelection({
    canValidateSelection: true,
    environments: [success(otherPath), success(defaultPath)],
    selectionsByWorkspace: {},
    workspaceRoot: root,
    ...options,
  });

describe("local environment path identity", () => {
  it.each([
    ["C:\\Work\\Repo\\", "c:/work/repo"],
    ["\\\\?\\C:\\Work\\Repo", "/C:/work/repo"],
    ["\\\\?\\UNC\\Server\\Share\\Repo", "//server/share/repo"],
    ["C:/Work/Repo", "/mnt/c/work/repo"],
    ["\\\\wsl.localhost\\Ubuntu\\mnt\\C\\Work\\Repo", "C:/work/repo"],
    [
      "\\\\wsl$\\Ubuntu\\home\\User\\Repo",
      "//wsl.localhost/ubuntu/home/User/Repo",
    ],
  ])("compares host path aliases %s and %s", (left, right) => {
    expect(areLocalEnvironmentPathsEqual(left, right)).toBe(true);
    expect(areLocalEnvironmentPathsEqual(right, left)).toBe(true);
  });
  it("preserves POSIX, WSL distro and mounted path case without an explicit Windows path", () => {
    for (const [left, right] of [
      ["/work/Repo", "/work/repo"],
      ["/mnt/c/Repo", "/mnt/c/repo"],
      ["//wsl$/Ubuntu/home/Repo", "//wsl$/Ubuntu/home/repo"],
      ["//wsl$/Ubuntu/home/repo", "//wsl$/Debian/home/repo"],
    ])
      expect(areLocalEnvironmentPathsEqual(left, right)).toBe(false);
  });
  it("keeps host identities separate and rejects an unavailable workspace", () => {
    expect(localEnvironmentWorkspaceKey(null)).toBeNull();
    expect(localEnvironmentWorkspaceKey("/")).toBeNull();
    expect(
      areLocalEnvironmentWorkspaceKeysEqual(
        "local:C:/Repo",
        "local:/mnt/c/repo",
      ),
    ).toBe(true);
    expect(
      areLocalEnvironmentWorkspaceKeysEqual("local:C:/Repo", "remote:C:/Repo"),
    ).toBe(false);
  });
});

describe("local environment selection resolution", () => {
  it("selects a default only when the caller requests it; prefers environment.toml", () => {
    expect(resolve().resolvedConfigPath).toBeNull();
    const selected = resolve({ selectDefaultEnvironment: true });
    expect(selected.savedConfigPath).toBeUndefined();
    expect(selected.resolvedConfigPath).toBe(defaultPath);
    expect(
      selected.availableEnvironments.map((entry) => entry.configPath),
    ).toEqual([otherPath]);
    expect(
      resolve({
        environments: [invalid(defaultPath), success(otherPath)],
        selectDefaultEnvironment: true,
      }).resolvedConfigPath,
    ).toBe(otherPath);
  });
  it("keeps explicit none independent from missing selection and defaults", () => {
    const selected = resolve({
      selectionsByWorkspace: { [key]: null },
      selectDefaultEnvironment: true,
    });
    expect(selected.savedConfigPath).toBeNull();
    expect(selected.resolvedConfigPath).toBeNull();
    expect(selected.repairConfigPath).toBeNull();
  });
  it("keeps saved paths during loading or failure and resolves missing paths only after success", () => {
    const saved = "/workspace/deleted.toml";
    expect(
      resolve({
        selectionsByWorkspace: { [key]: saved },
        canValidateSelection: false,
        environments: [],
      }).resolvedConfigPath,
    ).toBe(saved);
    expect(
      resolve({ selectionsByWorkspace: { [key]: saved } }).resolvedConfigPath,
    ).toBe(defaultPath);
    expect(
      resolve({ selectionsByWorkspace: { [key]: saved }, environments: [] })
        .resolvedConfigPath,
    ).toBeNull();
  });
  it("returns the canonical listed path for an equivalent saved Windows path", () => {
    const config = "C:/Work/Repo/.lime/environments/environment.toml";
    const selected = resolve({
      workspaceRoot: "C:/Work/Repo",
      environments: [success(config)],
      selectionsByWorkspace: { "local:c:/work/repo/": config.toLowerCase() },
    });
    expect(selected.resolvedConfigPath).toBe(config);
  });
  it("offers repair for a selected invalid config and never executes it", () => {
    const selected = resolve({
      environments: [invalid(defaultPath), success(otherPath)],
      selectionsByWorkspace: { [key]: defaultPath },
    });
    expect(selected.resolvedConfigPath).toBeNull();
    expect(selected.repairConfigPath).toBe(defaultPath);
    expect(
      resolve({ environments: [invalid(defaultPath)] }).repairConfigPath,
    ).toBe(defaultPath);
    expect(
      resolve({
        environments: [invalid(defaultPath)],
        selectionsByWorkspace: { [key]: null },
      }).repairConfigPath,
    ).toBeNull();
  });
  it("treats conflicting legacy aliases as explicit none while exact keys remain authoritative", () => {
    const selections = {
      "local:C:/Repo": "C:/Repo/a.toml",
      "local:c:/repo/": "C:/Repo/b.toml",
      "remote:C:/Repo": "C:/Repo/c.toml",
    };
    expect(
      getSavedLocalEnvironmentSelection(selections, "local:/mnt/c/repo"),
    ).toBeNull();
    expect(getSavedLocalEnvironmentSelection(selections, "local:C:/Repo")).toBe(
      "C:/Repo/a.toml",
    );
    expect(
      getSavedLocalEnvironmentSelection(selections, "missing:C:/Repo"),
    ).toBeUndefined();
  });
});
