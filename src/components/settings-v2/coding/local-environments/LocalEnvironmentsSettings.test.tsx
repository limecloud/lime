import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  listProjects,
  ensureProjectWorkspace,
  type Project,
} from "@/lib/api/project";
import { open } from "@/lib/desktop-host/dialog";
import { localEnvironments } from "@/lib/api/localEnvironments";
import { LocalEnvironmentsSettings } from "./LocalEnvironmentsSettings";
import type { LocalEnvironmentFocusContext } from "@/types/page";

vi.mock("@/lib/api/project", () => ({
  listProjects: vi.fn(),
  ensureProjectWorkspace: vi.fn(),
}));
vi.mock("@/lib/desktop-host/dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/api/localEnvironments", () => ({
  localEnvironments: {
    list: vi.fn(),
    readConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
}));

const project = {
  id: "project",
  name: "My project",
  rootPath: "/repo/project",
  isArchived: false,
} as Project;
const configPath = "/repo/project/.lime/environments/environment.toml";
const entry = {
  type: "success" as const,
  configPath,
  cwdRelativeToGitRoot: ".",
  environment: {
    version: 1,
    name: "Development",
    setup: { script: "npm ci", win32: { script: "npm.cmd ci" } },
    cleanup: { script: "npm run clean" },
    actions: [
      {
        name: "Test",
        command: "npm test",
        platform: null,
        icon: "test" as const,
      },
    ],
  },
};
let container: HTMLDivElement, root: Root;
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (target) => target.textContent?.includes(name),
  )!;
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function mount(focus?: LocalEnvironmentFocusContext) {
  await act(async () =>
    root.render(<LocalEnvironmentsSettings focus={focus} />),
  );
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  vi.mocked(listProjects).mockResolvedValue([project]);
  vi.mocked(localEnvironments.list).mockResolvedValue({
    environments: [entry],
  });
  vi.mocked(localEnvironments.readConfig).mockResolvedValue({
    configPath,
    exists: true,
    revision: "sha256:current",
    raw: "existing",
    environment: entry,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("LocalEnvironmentsSettings", () => {
  it("opens read-only script/action details before editing and returns without saving", async () => {
    await mount();
    await click(button("My project"));
    await click(button("Development"));
    expect(
      container.querySelector('[data-testid="local-environment-details"]'),
    ).not.toBeNull();
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(container.textContent).toContain("npm ci");
    expect(container.textContent).toContain("npm run clean");
    expect(container.querySelector("details")?.textContent).toContain(
      "npm test",
    );
    await click(button("Edit environment"));
    expect(
      container.querySelector('[data-testid="local-environment-editor"]'),
    ).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "Development",
    );
    await click(button("Back"));
    expect(
      container.querySelector('[data-testid="local-environment-details"]'),
    ).not.toBeNull();
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
  });

  it("keeps ancestor environments collapsed until requested", async () => {
    vi.mocked(localEnvironments.list).mockResolvedValue({
      environments: [
        entry,
        {
          ...entry,
          configPath: "/repo/.lime/environments/shared.toml",
          environment: { ...entry.environment, name: "Inherited shared" },
        },
      ],
    });
    await mount();
    await click(button("My project"));
    expect(container.textContent).not.toContain("Inherited shared");
    await click(button("Show inherited environments (1)"));
    expect(button("Inherited shared")).toBeDefined();
    await click(button("Hide inherited environments"));
    expect(container.textContent).not.toContain("Inherited shared");
  });

  it("does not create a workspace when the directory picker is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    await mount();
    await click(button("Add project"));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
    expect(ensureProjectWorkspace).not.toHaveBeenCalled();
    expect(button("Add project").disabled).toBe(false);
  });

  it("uses the selected directory and opens its project", async () => {
    vi.mocked(open).mockResolvedValue("C:\\work\\Example");
    vi.mocked(ensureProjectWorkspace).mockResolvedValue({
      ...project,
      name: "Example",
      rootPath: "C:\\work\\Example",
    });
    await mount();
    await click(button("Add project"));
    expect(ensureProjectWorkspace).toHaveBeenCalledWith({
      rootPath: "C:\\work\\Example",
      name: "Example",
    });
    expect(localEnvironments.list).toHaveBeenCalledWith("C:\\work\\Example");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
  });

  it("does not show archived projects and retries a failed project load", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(listProjects).mockResolvedValue([
      project,
      { ...project, id: "old", name: "Archived project", isArchived: true },
    ]);
    await click(button("Reload"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button("My project")).toBeDefined();
    expect(container.textContent).not.toContain("Archived project");
  });

  it("shows invalid details and opens explicit repair without silently overwriting the file", async () => {
    vi.mocked(localEnvironments.readConfig).mockResolvedValue({
      configPath,
      exists: true,
      revision: "sha256:invalid",
      raw: "broken",
      environment: {
        type: "error",
        configPath,
        cwdRelativeToGitRoot: ".",
        error: { message: "broken" },
      },
    });
    await mount();
    await click(button("My project"));
    await click(button("Development"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid environment configuration.",
    );
    expect(button("Edit environment").disabled).toBe(false);
    expect(container.querySelector("input, textarea")).toBeNull();
    await click(button("Edit environment"));
    expect(container.querySelector("input")).not.toBeNull();
    expect(localEnvironments.saveConfig).not.toHaveBeenCalled();
  });

  it("opens the requested repair config and handles the same request only once", async () => {
    const focus = {
      workspaceRoot: project.rootPath,
      configPath,
      requestKey: 1,
    };
    await mount(focus);
    expect(
      container.querySelector('[data-testid="local-environment-editor"]'),
    ).not.toBeNull();
    expect(localEnvironments.readConfig).toHaveBeenCalledWith(configPath);
    await click(button("Back"));
    await mount({ ...focus });
    expect(
      container.querySelector('[data-testid="local-environment-editor"]'),
    ).toBeNull();
    expect(ensureProjectWorkspace).not.toHaveBeenCalled();
  });

  it("ensures a focused workspace absent from the project list before opening it", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(ensureProjectWorkspace).mockResolvedValue(project);
    await mount({ workspaceRoot: project.rootPath, configPath });
    expect(ensureProjectWorkspace).toHaveBeenCalledExactlyOnceWith({
      rootPath: project.rootPath,
      name: "project",
    });
    expect(localEnvironments.readConfig).toHaveBeenCalledWith(configPath);
  });
});
