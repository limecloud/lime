import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/types/project";
import { ProjectSelector } from "./ProjectSelector";

const {
  mockUseProjects,
  mockToastError,
  mockToastSuccess,
  mockGetProject,
  mockGetDefaultProject,
} = vi.hoisted(() => ({
  mockUseProjects: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetDefaultProject: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: mockUseProjects,
}));

vi.mock("@/lib/api/project", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/project")>(
      "@/lib/api/project",
    );

  return {
    ...actual,
    getProject: mockGetProject,
    getDefaultProject: mockGetDefaultProject,
  };
});

vi.mock("@/components/projects/CreateProjectDialog", () => ({
  CreateProjectDialog: ({
    open,
    defaultType,
    allowedTypes,
  }: {
    open: boolean;
    defaultType?: string;
    allowedTypes?: string[];
  }) =>
    open ? (
      <div
        data-testid="create-project-dialog"
        data-default-type={defaultType}
        data-allowed-types={(allowedTypes || []).join(",")}
      />
    ) : null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = "button",
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    [key: string]: unknown;
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    ...rest
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

function createProject(overrides: Partial<Project>): Project {
  return {
    id: "project-id",
    name: "项目",
    workspaceType: "general",
    rootPath: "/tmp/project",
    isDefault: false,
    icon: undefined,
    color: undefined,
    isFavorite: false,
    isArchived: false,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

function createUseProjectsResult(overrides?: Record<string, unknown>) {
  return {
    projects: [],
    generalProjects: [],
    filteredProjects: [],
    defaultProject: null,
    loading: false,
    error: null,
    filter: {},
    setFilter: vi.fn(),
    refresh: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(async () => true),
    getOrCreateDefault: vi.fn(async () =>
      createProject({
        id: "default",
        name: "默认项目",
        isDefault: true,
        workspaceType: "general",
      }),
    ),
    ...overrides,
  };
}

function renderProjectSelector(
  props?: Partial<React.ComponentProps<typeof ProjectSelector>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof ProjectSelector> = {
    value: "default",
    onChange: vi.fn(),
    workspaceType: "general",
    enableManagement: true,
  };

  act(() => {
    root.render(<ProjectSelector {...defaultProps} {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

function findButton(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) || null) as HTMLButtonElement | null;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mockGetProject.mockResolvedValue(null);
  mockGetDefaultProject.mockResolvedValue(null);
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("ProjectSelector 组件", () => {
  it("默认项目在管理模式下不可重命名或删除", () => {
    const defaultProject = createProject({
      id: "default",
      name: "默认项目",
      isDefault: true,
      workspaceType: "general",
    });
    const generalProject = createProject({
      id: "general-1",
      name: "通用项目",
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [defaultProject, generalProject],
        generalProjects: [defaultProject, generalProject],
        defaultProject,
      }),
    );

    const container = renderProjectSelector({
      value: defaultProject.id,
      workspaceType: "general",
      enableManagement: true,
    });

    expect(findButton(container, "重命名")?.disabled).toBe(true);
    expect(findButton(container, "删除")?.disabled).toBe(true);
    expect(container.textContent).toContain("默认项目不可重命名或删除");
  });

  it("删除当前项目后应回退到默认项目", async () => {
    const onChange = vi.fn();
    const remove = vi.fn(async () => true);
    const defaultProject = createProject({
      id: "default",
      name: "默认项目",
      isDefault: true,
      workspaceType: "general",
    });
    const generalProject = createProject({
      id: "general-1",
      name: "通用项目",
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [defaultProject, generalProject],
        generalProjects: [defaultProject, generalProject],
        defaultProject,
        remove,
      }),
    );

    const container = renderProjectSelector({
      value: generalProject.id,
      workspaceType: "general",
      enableManagement: true,
      onChange,
    });

    act(() => {
      findButton(container, "删除")?.click();
    });
    await flushAsync();

    await act(async () => {
      findButton(container, "删除项目")?.click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(remove).toHaveBeenCalledWith(generalProject.id);
    expect(onChange).toHaveBeenCalledWith(defaultProject.id);
  });

  it("未启用管理模式时不显示管理操作区", () => {
    const defaultProject = createProject({
      id: "default",
      name: "默认项目",
      isDefault: true,
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [defaultProject],
        generalProjects: [defaultProject],
        defaultProject,
      }),
    );

    const container = renderProjectSelector({
      value: defaultProject.id,
      workspaceType: "general",
      enableManagement: false,
    });

    expect(findButton(container, "新建项目")).toBeNull();
    expect(findButton(container, "重命名")).toBeNull();
    expect(findButton(container, "删除")).toBeNull();
  });

  it("workspace-tab 模式应使用工作区文案", () => {
    const defaultProject = createProject({
      id: "default",
      name: "默认工作区",
      isDefault: true,
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [defaultProject],
        generalProjects: [defaultProject],
        defaultProject,
      }),
    );

    const container = renderProjectSelector({
      value: defaultProject.id,
      workspaceType: "general",
      enableManagement: true,
      chrome: "workspace-tab",
      placeholder: "选择工作区",
    });

    expect(container.textContent).toContain("选择工作区");
    expect(container.textContent).toContain("工作区管理");
    expect(findButton(container, "新建工作区")).not.toBeNull();
    expect(findButton(container, "新建项目")).toBeNull();
  });

  it("延后列表加载时应先用项目摘要渲染当前项目", async () => {
    const selectedProject = createProject({
      id: "general-1",
      name: "当前项目",
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [],
        generalProjects: [],
        defaultProject: null,
      }),
    );
    mockGetProject.mockResolvedValue(selectedProject);

    const container = renderProjectSelector({
      value: selectedProject.id,
      workspaceType: "general",
      deferProjectListLoad: true,
    });

    await flushAsync();
    await flushAsync();

    expect(mockUseProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        autoLoad: false,
      }),
    );
    expect(mockGetProject).toHaveBeenCalledWith(selectedProject.id);
    expect(container.textContent).toContain(selectedProject.name);
  });

  it("延后列表加载且未指定项目时应回填默认项目", async () => {
    const onChange = vi.fn();
    const defaultProject = createProject({
      id: "default",
      name: "默认项目",
      isDefault: true,
      workspaceType: "general",
    });

    mockUseProjects.mockReturnValue(
      createUseProjectsResult({
        projects: [],
        generalProjects: [],
        defaultProject: null,
      }),
    );
    mockGetDefaultProject.mockResolvedValue(defaultProject);

    renderProjectSelector({
      value: null,
      workspaceType: "general",
      deferProjectListLoad: true,
      onChange,
    });

    await flushAsync();
    await flushAsync();

    expect(mockGetDefaultProject).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(defaultProject.id);
  });
});
