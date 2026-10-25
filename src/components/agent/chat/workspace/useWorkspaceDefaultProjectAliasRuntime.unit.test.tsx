import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureWorkspaceReady,
  getProject,
  type Project,
  type WorkspaceEnsureResult,
} from "@/lib/api/project";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  shouldResolveDefaultProjectAlias,
  useWorkspaceDefaultProjectAliasRuntime,
} from "./useWorkspaceDefaultProjectAliasRuntime";

vi.mock("@/lib/api/project", () => ({
  ensureWorkspaceReady: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: vi.fn(),
}));

interface HarnessProps {
  applyProjectSelection?: (projectId?: string | null) => void;
  externalProjectId?: string | null;
  getRememberedProjectId?: () => string | null;
  projectId?: string | null;
  resetProjectSelection?: () => void;
}

let container: HTMLDivElement;
let root: Root;
let latestProject: Project | null = null;

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: "remembered-project",
    name: "Remembered",
    rootPath: "/old-root",
    workspaceType: "general",
    isArchived: false,
    ...overrides,
  } as Project;
}

function workspaceEnsureResultFixture(
  overrides: Partial<WorkspaceEnsureResult> = {},
): WorkspaceEnsureResult {
  return {
    workspaceId: "remembered-project",
    rootPath: "/repaired-root",
    existed: true,
    created: false,
    repaired: false,
    ...overrides,
  };
}

function Harness({
  applyProjectSelection = () => undefined,
  externalProjectId = "default",
  getRememberedProjectId = () => "remembered-project",
  projectId = null,
  resetProjectSelection = () => undefined,
}: HarnessProps) {
  const [project, setProject] = useState<Project | null>(null);
  latestProject = project;
  useWorkspaceDefaultProjectAliasRuntime({
    applyProjectSelection,
    externalProjectId,
    getRememberedProjectId,
    projectId,
    resetProjectSelection,
    setProject,
  });
  return null;
}

function renderHarness(props?: HarnessProps) {
  act(() => {
    root.render(<Harness {...props} />);
  });
}

async function flushEffects(times = 4): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("shouldResolveDefaultProjectAlias", () => {
  it("只在默认别名且当前没有项目时触发", () => {
    expect(shouldResolveDefaultProjectAlias("default", null)).toBe(true);
    expect(shouldResolveDefaultProjectAlias("workspace-default", null)).toBe(
      true,
    );
    expect(shouldResolveDefaultProjectAlias("project-a", null)).toBe(false);
    expect(shouldResolveDefaultProjectAlias("default", "project-a")).toBe(
      false,
    );
  });
});

describe("useWorkspaceDefaultProjectAliasRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestProject = null;
    vi.mocked(getProject).mockResolvedValue(projectFixture());
    vi.mocked(ensureWorkspaceReady).mockResolvedValue(
      workspaceEnsureResultFixture(),
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    latestProject = null;
  });

  it("有 remembered project 时应应用项目并使用 ensure 后的 rootPath", async () => {
    const applyProjectSelection = vi.fn();

    renderHarness({ applyProjectSelection });
    await flushEffects();

    expect(getProject).toHaveBeenCalledWith("remembered-project");
    expect(ensureWorkspaceReady).toHaveBeenCalledWith("remembered-project");
    expect(applyProjectSelection).toHaveBeenCalledWith("remembered-project");
    expect(latestProject?.rootPath).toBe("/repaired-root");
  });

  it("没有可用 remembered project 时应回到 detached 状态", async () => {
    vi.mocked(getProject).mockResolvedValueOnce(null);
    const resetProjectSelection = vi.fn();

    renderHarness({ resetProjectSelection });
    await flushEffects();

    expect(resetProjectSelection).toHaveBeenCalledTimes(1);
    expect(latestProject).toBeNull();
    expect(logAgentDebug).toHaveBeenCalledWith(
      "LocalConversationPage",
      "resolveDefaultProjectAlias.detached",
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
  });
});
