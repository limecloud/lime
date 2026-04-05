import { describe, expect, it } from "vitest";
import type { Project } from "@/types/project";
import {
  canDeleteProject,
  canRenameProject,
  getAvailableProjects,
  resolveProjectDeletionFallback,
  resolveSelectedProject,
} from "./projectSelectorUtils";

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

describe("getAvailableProjects", () => {
  it("workspaceType 为 general 时保留所有未归档的 general 项目，并把默认项目置顶", () => {
    const projects = [
      createProject({
        id: "default",
        name: "默认项目",
        isDefault: true,
        workspaceType: "general",
      }),
      createProject({
        id: "general-1",
        name: "通用项目",
        workspaceType: "general",
      }),
      createProject({
        id: "social-1",
        name: "社媒项目",
        workspaceType: "general",
      }),
    ];

    const result = getAvailableProjects(projects, "general");

    expect(result.map((project) => project.id)).toEqual([
      "default",
      "general-1",
      "social-1",
    ]);
  });

  it("workspaceType 为 general 时应排除归档项目", () => {
    const projects = [
      createProject({
        id: "default",
        name: "默认项目",
        isDefault: true,
        workspaceType: "general",
      }),
      createProject({
        id: "social-1",
        name: "社媒项目 A",
        workspaceType: "general",
      }),
      createProject({
        id: "social-archived",
        name: "社媒项目归档",
        workspaceType: "general",
        isArchived: true,
      }),
      createProject({
        id: "general-1",
        name: "通用项目",
        workspaceType: "general",
      }),
    ];

    const result = getAvailableProjects(projects, "general");

    expect(result.map((project) => project.id)).toEqual([
      "default",
      "social-1",
      "general-1",
    ]);
  });

  it("未提供 workspaceType 时返回全部未归档项目，默认项目置顶", () => {
    const projects = [
      createProject({
        id: "social-1",
        name: "社媒项目",
        workspaceType: "general",
      }),
      createProject({
        id: "default",
        name: "默认项目",
        isDefault: true,
        workspaceType: "general",
      }),
      createProject({
        id: "general-1",
        name: "通用项目",
        workspaceType: "general",
      }),
      createProject({
        id: "archived",
        name: "归档项目",
        workspaceType: "general",
        isArchived: true,
      }),
    ];

    const result = getAvailableProjects(projects);

    expect(result.map((project) => project.id)).toEqual([
      "default",
      "social-1",
      "general-1",
    ]);
  });
});

describe("项目管理辅助逻辑", () => {
  it("默认项目不可重命名或删除", () => {
    const defaultProject = createProject({
      id: "default",
      isDefault: true,
      workspaceType: "general",
    });
    const normalProject = createProject({
      id: "normal",
      workspaceType: "general",
    });

    expect(canRenameProject(defaultProject)).toBe(false);
    expect(canDeleteProject(defaultProject)).toBe(false);
    expect(canRenameProject(normalProject)).toBe(true);
    expect(canDeleteProject(normalProject)).toBe(true);
  });

  it("删除当前项目时应优先回退到默认项目", () => {
    const defaultProject = createProject({
      id: "default",
      isDefault: true,
      workspaceType: "general",
    });
    const deletedProject = createProject({
      id: "general-2",
      workspaceType: "general",
    });

    expect(
      resolveProjectDeletionFallback(
        [defaultProject, deletedProject],
        defaultProject,
        deletedProject.id,
      ),
    ).toBe("default");
  });

  it("当前选择失效时应回退默认项目或首个项目", () => {
    const defaultProject = createProject({
      id: "default",
      isDefault: true,
      workspaceType: "general",
    });
    const secondaryProject = createProject({
      id: "general-2",
      workspaceType: "general",
    });

    expect(
      resolveSelectedProject(
        [defaultProject, secondaryProject],
        "missing",
        defaultProject,
      )?.id,
    ).toBe("default");

    expect(resolveSelectedProject([secondaryProject], "missing", null)?.id).toBe(
      "general-2",
    );
  });
});
