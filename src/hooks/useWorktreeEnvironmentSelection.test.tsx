import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorktreeEnvironmentSelection } from "./useWorktreeEnvironmentSelection";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  setProjectGitWorktreeEnvironment,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";

vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: { list: vi.fn() },
}));
vi.mock("@/lib/api/projectGit", () => ({
  setProjectGitWorktreeEnvironment: vi.fn(),
}));
const path = "/tree/.lime/environments/environment.toml";
const environment = {
  type: "success" as const,
  configPath: path,
  cwdRelativeToGitRoot: ".",
  environment: { name: "Dev", version: 1, setup: { script: "" } },
};
const status: ProjectGitStatus = {
  rootPath: "/tree",
  repositoryRoot: "/tree",
  hasGitRepository: true,
  isWorktree: true,
  localEnvironmentConfigPath: null,
  branches: [],
  uncommittedFileCount: 0,
};
let root: Root,
  container: HTMLDivElement,
  value: ReturnType<typeof useWorktreeEnvironmentSelection>;
function Probe({
  current,
  enabled,
}: {
  current: ProjectGitStatus;
  enabled: boolean;
}) {
  value = useWorktreeEnvironmentSelection({
    workspaceRoot: current.rootPath,
    status: current,
    enabled,
    refresh: 0,
  });
  return <output>{value.resolvedConfigPath}</output>;
}
async function render(current = status, enabled = true) {
  await act(async () =>
    root.render(<Probe current={current} enabled={enabled} />),
  );
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.mocked(localEnvironments.list).mockResolvedValue({
    environments: [environment],
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("keeps explicit Git None even when the checkout contains a default environment", async () => {
  await render();
  expect(value.defaultEnvironment).toEqual(environment);
  expect(value.resolvedConfigPath).toBeNull();
  expect(value.resetSelection).toBeUndefined();
  expect(value.ready).toBe(true);
  expect(localEnvironments.list).toHaveBeenCalledExactlyOnceWith("/tree");
});

it("writes only the Git API and adopts a confirmed selection or None", async () => {
  await render();
  vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce({
    ...status,
    localEnvironmentConfigPath: path,
  });
  await act(async () => expect(await value.updateSelection(path)).toBe(true));
  expect(value.resolvedConfigPath).toBe(path);
  expect(setProjectGitWorktreeEnvironment).toHaveBeenCalledExactlyOnceWith(
    "/tree",
    path,
  );
  vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce(status);
  await act(async () => expect(await value.updateSelection(null)).toBe(true));
  expect(value.resolvedConfigPath).toBeNull();
});

it("retains the confirmed selection on failure and allows retry", async () => {
  await render({ ...status, localEnvironmentConfigPath: path });
  vi.mocked(setProjectGitWorktreeEnvironment).mockRejectedValueOnce(
    new Error("disk unavailable"),
  );
  await act(async () => expect(await value.updateSelection(null)).toBe(false));
  expect(value.resolvedConfigPath).toBe(path);
  vi.mocked(setProjectGitWorktreeEnvironment).mockResolvedValueOnce(status);
  await act(async () => expect(await value.updateSelection(null)).toBe(true));
  expect(value.resolvedConfigPath).toBeNull();
});

it("ignores a late write after switching checkout and serializes pending writes", async () => {
  await render();
  let resolve!: (status: ProjectGitStatus) => void;
  vi.mocked(setProjectGitWorktreeEnvironment).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = value.updateSelection(path);
  });
  expect(value.updating).toBe(true);
  await act(async () => expect(await value.updateSelection(null)).toBe(false));
  const other = { ...status, rootPath: "/other", repositoryRoot: "/other" };
  await render(other);
  await act(async () => {
    resolve({ ...status, localEnvironmentConfigPath: path });
    expect(await pending).toBe(false);
  });
  expect(value.resolvedConfigPath).toBeNull();
  expect(value.updating).toBe(false);
  expect(setProjectGitWorktreeEnvironment).toHaveBeenCalledTimes(1);
});

it("does not read or write a source checkout, disabled surface or failed list", async () => {
  await render({ ...status, isWorktree: false });
  await act(async () => expect(await value.updateSelection(path)).toBe(false));
  expect(localEnvironments.list).not.toHaveBeenCalled();
  await render(status, false);
  expect(localEnvironments.list).not.toHaveBeenCalled();
  vi.mocked(localEnvironments.list).mockRejectedValueOnce(
    new Error("unavailable"),
  );
  await render();
  expect(value.error).toBe(true);
  await act(async () => expect(await value.updateSelection(path)).toBe(false));
  expect(setProjectGitWorktreeEnvironment).not.toHaveBeenCalled();
  await act(async () => value.reload());
  expect(value.ready).toBe(true);
});
