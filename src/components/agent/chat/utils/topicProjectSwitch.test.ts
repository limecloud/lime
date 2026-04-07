import { describe, expect, it, vi } from "vitest";
import {
  resolveTopicSwitchProject,
  type TopicProjectSnapshot,
} from "./topicProjectSwitch";

function makeProject(id: string, isArchived = false): TopicProjectSnapshot {
  return { id, isArchived };
}

describe("resolveTopicSwitchProject", () => {
  it("外部锁定项目与话题绑定冲突时应阻止切换", async () => {
    const result = await resolveTopicSwitchProject({
      lockedProjectId: "project-a",
      topicBoundProjectId: "project-b",
      lastProjectId: "project-c",
      loadProjectById: vi.fn(),
      loadDefaultProject: vi.fn(),
      createDefaultProject: vi.fn(),
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "locked_project_conflict",
    });
  });

  it("外部锁定项目无冲突时应直接返回锁定项目", async () => {
    const loadProjectById = vi.fn();
    const loadDefaultProject = vi.fn();
    const createDefaultProject = vi.fn();

    const result = await resolveTopicSwitchProject({
      lockedProjectId: "project-a",
      topicBoundProjectId: "project-a",
      lastProjectId: "project-c",
      loadProjectById,
      loadDefaultProject,
      createDefaultProject,
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "project-a",
      createdDefault: false,
    });
    expect(loadProjectById).not.toHaveBeenCalled();
    expect(loadDefaultProject).not.toHaveBeenCalled();
    expect(createDefaultProject).not.toHaveBeenCalled();
  });

  it("应优先使用话题绑定项目", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: "topic-project",
      lastProjectId: "last-project",
      loadProjectById: vi.fn(async (projectId: string) =>
        projectId === "topic-project" ? makeProject(projectId) : null,
      ),
      loadDefaultProject: vi.fn(async () => makeProject("default-project")),
      createDefaultProject: vi.fn(async () => makeProject("created-default")),
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "topic-project",
      createdDefault: false,
    });
  });

  it("话题绑定不可用时应回退上次项目", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: "topic-project",
      lastProjectId: "last-project",
      loadProjectById: vi.fn(async (projectId: string) =>
        projectId === "last-project" ? makeProject(projectId) : null,
      ),
      loadDefaultProject: vi.fn(async () => makeProject("default-project")),
      createDefaultProject: vi.fn(async () => makeProject("created-default")),
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "last-project",
      createdDefault: false,
    });
  });

  it("上次项目不可用时应回退默认项目", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: null,
      lastProjectId: "last-project",
      loadProjectById: vi.fn(async () => null),
      loadDefaultProject: vi.fn(async () => makeProject("default-project")),
      createDefaultProject: vi.fn(async () => makeProject("created-default")),
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "default-project",
      createdDefault: false,
    });
  });

  it("默认项目缺失时应创建默认项目", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: null,
      lastProjectId: null,
      loadProjectById: vi.fn(async () => null),
      loadDefaultProject: vi.fn(async () => null),
      createDefaultProject: vi.fn(async () => makeProject("created-default")),
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "created-default",
      createdDefault: true,
    });
  });

  it("所有来源都不可用时应返回 missing", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: null,
      lastProjectId: null,
      loadProjectById: vi.fn(async () => null),
      loadDefaultProject: vi.fn(async () => null),
      createDefaultProject: vi.fn(async () => null),
    });

    expect(result).toEqual({
      status: "missing",
      reason: "no_available_project",
    });
  });

  it("归档项目不应作为可用项目", async () => {
    const result = await resolveTopicSwitchProject({
      topicBoundProjectId: "topic-project",
      lastProjectId: null,
      loadProjectById: vi.fn(async () => makeProject("topic-project", true)),
      loadDefaultProject: vi.fn(async () =>
        makeProject("default-project", true),
      ),
      createDefaultProject: vi.fn(async () => makeProject("created-default")),
    });

    expect(result).toEqual({
      status: "ok",
      projectId: "created-default",
      createdDefault: true,
    });
  });
});
