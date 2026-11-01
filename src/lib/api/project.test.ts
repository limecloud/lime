/**
 * @file 项目管理 API 测试
 * @description 测试项目（Project）和内容（Content）的 API 功能
 * @module lib/api/project.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createContent,
  createProject,
  deleteContent,
  deleteProject,
  ensureProjectWorkspace,
  ensureWorkspaceReady,
  ensureDefaultWorkspaceReady,
  getContent,
  getContentStats,
  getWorkspaceProjectsRoot,
  getOrCreateDefaultProject,
  resolveProjectRootPath,
  getProjectByRootPath,
  getDefaultProject,
  getProject,
  getGeneralWorkbenchDocumentState,
  listContents,
  listProjects,
  requireDefaultProject,
  requireDefaultProjectId,
  reorderContents,
  setDefaultProject,
  updateContent,
  updateProject,
  isUserProjectType,
  getProjectTypeLabel,
  getProjectTypeIcon,
  getContentTypeLabel,
  getContentStatusLabel,
  getDefaultContentTypeForProject,
  getCanvasTypeForProjectType,
  getCreateProjectErrorMessage,
  extractErrorMessage,
  clearProjectDetailCacheForTests,
  normalizeProject,
  formatWordCount,
  formatRelativeTime,
  TYPE_CONFIGS,
  USER_PROJECT_TYPES,
  type ProjectType,
  type ContentType,
  type ContentStatus,
} from "./project";

const appServerRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: vi.fn(function () {
    return { request: appServerRequestMock };
  }),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

function resolveAppServerRequest<T>(result: T): void {
  appServerRequestMock.mockResolvedValueOnce({ result });
}

function expectAppServerRequest(
  index: number,
  method: string,
  params: unknown,
): void {
  expect(appServerRequestMock).toHaveBeenNthCalledWith(index, method, params);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

// ============================================================================
// 辅助函数测试
// ============================================================================

describe("项目管理 API", () => {
  describe("workspace 路径 API", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      appServerRequestMock.mockReset();
      clearProjectDetailCacheForTests();
    });

    it("应该通过 App Server 获取 workspace 根目录", async () => {
      resolveAppServerRequest({ rootPath: "/Users/test/.lime/projects" });

      const root = await getWorkspaceProjectsRoot();

      expect(root).toBe("/Users/test/.lime/projects");
      expectAppServerRequest(1, "workspace/projectsRoot/read", {});
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 解析项目目录", async () => {
      resolveAppServerRequest({
        rootPath: "/Users/test/.lime/projects/MyProject",
      });

      const path = await resolveProjectRootPath("MyProject");

      expect(path).toBe("/Users/test/.lime/projects/MyProject");
      expectAppServerRequest(1, "workspace/projectPath/resolve", {
        name: "MyProject",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该支持按用户选择的父目录解析项目目录", async () => {
      resolveAppServerRequest({
        rootPath: "/Users/test/Documents/MyProject",
      });

      const path = await resolveProjectRootPath(
        "MyProject",
        "/Users/test/Documents",
      );

      expect(path).toBe("/Users/test/Documents/MyProject");
      expectAppServerRequest(1, "workspace/projectPath/resolve", {
        name: "MyProject",
        parentRootPath: "/Users/test/Documents",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该忽略空白父目录并交给后端使用默认目录", async () => {
      resolveAppServerRequest({
        rootPath: "/Users/test/.lime/projects/MyProject",
      });

      const path = await resolveProjectRootPath("MyProject", "   ");

      expect(path).toBe("/Users/test/.lime/projects/MyProject");
      expectAppServerRequest(1, "workspace/projectPath/resolve", {
        name: "MyProject",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该将空名称传给后端统一处理", async () => {
      resolveAppServerRequest({
        rootPath: "/Users/test/.lime/projects/未命名项目",
      });

      const path = await resolveProjectRootPath("   ");

      expect(path).toBe("/Users/test/.lime/projects/未命名项目");
      expectAppServerRequest(1, "workspace/projectPath/resolve", {
        name: "   ",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 按路径获取项目", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "p1",
          name: "测试项目",
          workspace_type: "general",
          root_path: "/Users/test/.lime/projects/demo",
        },
      });

      const project = await getProjectByRootPath(
        "/Users/test/.lime/projects/demo",
      );

      expect(project?.id).toBe("p1");
      expect(project?.rootPath).toBe("/Users/test/.lime/projects/demo");
      expectAppServerRequest(1, "workspace/byPath/read", {
        rootPath: "/Users/test/.lime/projects/demo",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server ensure 本地项目工作区", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "project-ensure",
          name: "新项目",
          workspace_type: "general",
          root_path: "/Users/test/.lime/projects/new-project",
        },
        created: true,
        rootCreated: true,
      });

      const project = await ensureProjectWorkspace({
        name: " 新项目 ",
        rootPath: " /Users/test/.lime/projects/new-project ",
        workspaceType: "general",
      });

      expect(project).toEqual(
        expect.objectContaining({
          id: "project-ensure",
          name: "新项目",
          workspaceType: "general",
          rootPath: "/Users/test/.lime/projects/new-project",
        }),
      );
      expectAppServerRequest(1, "workspace/ensure", {
        name: "新项目",
        rootPath: "/Users/test/.lime/projects/new-project",
        workspaceType: "general",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("ensureProjectWorkspace 缺少项目目录时应 fail closed", async () => {
      await expect(
        ensureProjectWorkspace({
          name: "空目录项目",
          rootPath: "   ",
          workspaceType: "general",
        }),
      ).rejects.toThrow("workspace rootPath is required to ensure project");
      expect(appServerRequestMock).not.toHaveBeenCalled();
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("按路径查询不存在项目时应该返回 null", async () => {
      resolveAppServerRequest({ workspace: null });

      const project = await getProjectByRootPath(
        "/Users/test/.lime/projects/missing",
      );

      expect(project).toBeNull();
      expectAppServerRequest(1, "workspace/byPath/read", {
        rootPath: "/Users/test/.lime/projects/missing",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 获取并标准化默认项目", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "default-1",
          name: "默认项目",
          workspace_type: "general",
          root_path: "/Users/test/.lime/projects/default",
          is_default: true,
        },
      });

      const project = await getDefaultProject();

      expect(project).toEqual(
        expect.objectContaining({
          id: "default-1",
          name: "默认项目",
          workspaceType: "general",
          rootPath: "/Users/test/.lime/projects/default",
          isDefault: true,
        }),
      );
      expectAppServerRequest(1, "workspace/default/read", {});
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("requireDefaultProject 缺失默认项目时应抛指定错误", async () => {
      resolveAppServerRequest({ workspace: null });

      await expect(requireDefaultProject("请先创建默认项目")).rejects.toThrow(
        "请先创建默认项目",
      );
      expectAppServerRequest(1, "workspace/default/read", {});
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("requireDefaultProjectId 应返回默认项目 ID", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "default-2",
          name: "默认项目 2",
        },
      });

      await expect(requireDefaultProjectId()).resolves.toBe("default-2");
      expectAppServerRequest(1, "workspace/default/read", {});
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 确保工作区目录就绪", async () => {
      resolveAppServerRequest({
        result: {
          workspaceId: "default-3",
          rootPath: "/tmp/default-3",
          existed: true,
          created: false,
          repaired: true,
        },
      });

      await expect(ensureWorkspaceReady("default-3")).resolves.toEqual({
        workspaceId: "default-3",
        rootPath: "/tmp/default-3",
        existed: true,
        created: false,
        repaired: true,
      });
      expectAppServerRequest(1, "workspace/ensureReady", {
        id: "default-3",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("确保默认工作区目录就绪时应先 ensure 默认 workspace 再 ensureReady", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "default-3",
          name: "默认项目 3",
        },
      });
      resolveAppServerRequest({
        result: {
          workspaceId: "default-3",
          rootPath: "/tmp/default-3",
          existed: true,
          created: false,
          repaired: true,
        },
      });

      await expect(ensureDefaultWorkspaceReady()).resolves.toEqual({
        workspaceId: "default-3",
        rootPath: "/tmp/default-3",
        existed: true,
        created: false,
        repaired: true,
      });
      expectAppServerRequest(1, "workspace/default/ensure", {});
      expectAppServerRequest(2, "workspace/ensureReady", {
        id: "default-3",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("确保默认工作区目录就绪时应支持缺失 workspace 并 fail closed", async () => {
      resolveAppServerRequest({ workspace: null });

      await expect(ensureDefaultWorkspaceReady()).resolves.toBeNull();
      expectAppServerRequest(1, "workspace/default/ensure", {});
      expect(appServerRequestMock).toHaveBeenCalledTimes(1);
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("设置默认项目默认 fail closed，不能回到旧 native 命令", async () => {
      await expect(setDefaultProject("default-4")).rejects.toThrow(
        "workspace_set_default is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("项目创建和设置默认仍 fail closed，读链仍通过 App Server", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "project-1",
          name: "项目 1-更新",
          workspace_type: "general",
          root_path: "/tmp/project-1",
        },
      });
      resolveAppServerRequest({ deleted: true });
      resolveAppServerRequest({
        workspaces: [
          {
            id: "project-1",
            name: "项目 1",
            workspace_type: "general",
            root_path: "/tmp/project-1",
          },
        ],
      });
      resolveAppServerRequest({
        workspace: {
          id: "default-5",
          name: "默认项目 5",
          workspace_type: "general",
          root_path: "/tmp/default-5",
        },
      });
      resolveAppServerRequest({
        workspace: {
          id: "project-1",
          name: "项目 1",
          workspace_type: "general",
          root_path: "/tmp/project-1",
        },
      });

      await expect(
        createProject({
          name: "项目 1",
          rootPath: "/tmp/project-1",
          workspaceType: "general",
        }),
      ).rejects.toThrow(
        "workspace_create is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(
        updateProject("project-1", { name: "项目 1-更新" }),
      ).resolves.toEqual(expect.objectContaining({ name: "项目 1-更新" }));
      await expect(deleteProject("project-1", false)).resolves.toBe(true);
      await expect(listProjects()).resolves.toEqual([
        expect.objectContaining({ id: "project-1" }),
      ]);
      await expect(getOrCreateDefaultProject()).resolves.toEqual(
        expect.objectContaining({ id: "default-5" }),
      );
      await expect(getProject("project-1")).resolves.toEqual(
        expect.objectContaining({ id: "project-1" }),
      );
      expectAppServerRequest(1, "workspace/update", {
        id: "project-1",
        name: "项目 1-更新",
      });
      expectAppServerRequest(2, "workspace/delete", {
        id: "project-1",
        deleteDirectory: false,
      });
      expectAppServerRequest(3, "workspace/list", {});
      expectAppServerRequest(4, "workspace/default/ensure", {});
      expectAppServerRequest(5, "workspace/read", {
        id: "project-1",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 更新项目", async () => {
      resolveAppServerRequest({
        workspace: {
          id: "project-update",
          name: "更新后项目",
          workspace_type: "general",
          root_path: "/tmp/project-update",
          is_favorite: true,
        },
      });

      await expect(
        updateProject(" project-update ", {
          name: "更新后项目",
          isFavorite: true,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          id: "project-update",
          name: "更新后项目",
          isFavorite: true,
        }),
      );

      expectAppServerRequest(1, "workspace/update", {
        id: "project-update",
        name: "更新后项目",
        isFavorite: true,
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("应该通过 App Server 移除项目记录但不删除本地目录", async () => {
      resolveAppServerRequest({ deleted: true });

      await expect(deleteProject(" project-delete ")).resolves.toBe(true);

      expectAppServerRequest(1, "workspace/delete", {
        id: "project-delete",
        deleteDirectory: false,
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("项目更新和删除缺少 workspace id 时应 fail closed", async () => {
      await expect(updateProject("   ", { name: "空项目" })).rejects.toThrow(
        "workspace id is required to update project",
      );
      await expect(deleteProject("   ")).rejects.toThrow(
        "workspace id is required to delete project",
      );

      expect(appServerRequestMock).not.toHaveBeenCalled();
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("短时间重复获取同一项目应复用 workspace/read 缓存", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
      try {
        resolveAppServerRequest({
          workspace: {
            id: "cached-project",
            name: "缓存项目",
            workspace_type: "general",
            root_path: "/tmp/cached-project",
          },
        });
        resolveAppServerRequest({
          workspace: {
            id: "cached-project",
            name: "缓存项目刷新",
            workspace_type: "general",
            root_path: "/tmp/cached-project",
          },
        });

        await expect(getProject("cached-project")).resolves.toEqual(
          expect.objectContaining({ name: "缓存项目" }),
        );
        nowSpy.mockReturnValue(1_500);
        await expect(getProject("cached-project")).resolves.toEqual(
          expect.objectContaining({ name: "缓存项目" }),
        );

        nowSpy.mockReturnValue(2_001);
        await expect(getProject("cached-project")).resolves.toEqual(
          expect.objectContaining({ name: "缓存项目刷新" }),
        );

        expect(appServerRequestMock).toHaveBeenCalledTimes(2);
        expectAppServerRequest(1, "workspace/read", {
          id: "cached-project",
        });
        expectAppServerRequest(2, "workspace/read", {
          id: "cached-project",
        });
        expect(safeInvoke).not.toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("并发获取同一项目时应合并为一次 workspace/read", async () => {
      const deferred = createDeferred<{
        result: {
          workspace: {
            id: string;
            name: string;
            workspace_type: string;
            root_path: string;
          };
        };
      }>();
      appServerRequestMock.mockReturnValueOnce(deferred.promise);

      const first = getProject("parallel-project");
      const second = getProject("parallel-project");
      deferred.resolve({
        result: {
          workspace: {
            id: "parallel-project",
            name: "并发项目",
            workspace_type: "general",
            root_path: "/tmp/parallel-project",
          },
        },
      });

      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ id: "parallel-project", name: "并发项目" }),
        expect.objectContaining({ id: "parallel-project", name: "并发项目" }),
      ]);
      expect(appServerRequestMock).toHaveBeenCalledTimes(1);
      expect(appServerRequestMock).toHaveBeenCalledWith("workspace/read", {
        id: "parallel-project",
      });
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("workspace read/ensure 缺少必需 App Server result 时不应回退 legacy", async () => {
      resolveAppServerRequest({});
      await expect(getWorkspaceProjectsRoot()).rejects.toThrow(
        "App Server workspace/projectsRoot/read did not return rootPath",
      );

      appServerRequestMock.mockReset();
      resolveAppServerRequest({});
      await expect(resolveProjectRootPath("MyProject")).rejects.toThrow(
        "App Server workspace/projectPath/resolve did not return rootPath",
      );

      appServerRequestMock.mockReset();
      resolveAppServerRequest({});
      await expect(ensureWorkspaceReady("project-1")).rejects.toThrow(
        "App Server workspace/ensureReady did not return result",
      );

      appServerRequestMock.mockReset();
      resolveAppServerRequest({});
      await expect(getOrCreateDefaultProject()).rejects.toThrow(
        "App Server workspace/default/ensure did not return workspace",
      );

      expect(safeInvoke).not.toHaveBeenCalledWith(
        "workspace_get_projects_root",
      );
      expect(safeInvoke).not.toHaveBeenCalledWith(
        "workspace_resolve_project_path",
        expect.anything(),
      );
      expect(safeInvoke).not.toHaveBeenCalledWith(
        "workspace_ensure_ready",
        expect.anything(),
      );
      expect(safeInvoke).not.toHaveBeenCalledWith(
        "get_or_create_default_project",
      );
    });

    it("ensureWorkspaceReady 缺少 workspace id 时应 fail closed", async () => {
      await expect(ensureWorkspaceReady("   ")).rejects.toThrow(
        "workspace id is required to ensure App Server workspace",
      );

      expect(appServerRequestMock).not.toHaveBeenCalled();
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("Content / General Workbench 命令默认 fail closed，不能回到旧 native 命令", async () => {
      await expect(
        createContent({
          project_id: "project-1",
          title: "第一章",
          content_type: "chapter",
        }),
      ).rejects.toThrow(
        "content_create is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(getContent("content-1")).rejects.toThrow(
        "content_get is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(
        getGeneralWorkbenchDocumentState("content-1"),
      ).rejects.toThrow(
        "content_get_general_workbench_document_state is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(
        listContents("project-1", { content_type: "chapter" }),
      ).rejects.toThrow(
        "content_list is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(
        updateContent("content-1", {
          title: "第一章-修订",
          status: "completed",
        }),
      ).rejects.toThrow(
        "content_update is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(deleteContent("content-1")).rejects.toThrow(
        "content_delete is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(
        reorderContents("project-1", ["content-1"]),
      ).rejects.toThrow(
        "content_reorder is retired until Workspace writes and Content CRUD move to App Server current methods",
      );
      await expect(getContentStats("project-1")).rejects.toThrow(
        "content_stats is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("Workspace / Content retired 命令应在 diagnostic facade 前 fail closed", async () => {
      vi.mocked(safeInvoke).mockResolvedValue({ diagnostic: true });

      await expect(
        createProject({ name: "诊断项目", rootPath: "/tmp/diagnostic" }),
      ).rejects.toThrow(
        "workspace_create is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      resolveAppServerRequest({});
      await expect(updateProject("project-1", { name: "诊断" })).rejects.toThrow(
        "App Server workspace/update did not return workspace",
      );

      resolveAppServerRequest({ deleted: false });
      await expect(deleteProject("project-1", true)).resolves.toBe(false);

      await expect(setDefaultProject("project-1")).rejects.toThrow(
        "workspace_set_default is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(
        createContent({ project_id: "project-1", title: "诊断内容" }),
      ).rejects.toThrow(
        "content_create is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(getContent("content-1")).rejects.toThrow(
        "content_get is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(
        getGeneralWorkbenchDocumentState("content-1"),
      ).rejects.toThrow(
        "content_get_general_workbench_document_state is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(listContents("project-1")).rejects.toThrow(
        "content_list is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(updateContent("content-1", { title: "诊断" })).rejects.toThrow(
        "content_update is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(deleteContent("content-1")).rejects.toThrow(
        "content_delete is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(
        reorderContents("project-1", ["content-1"]),
      ).rejects.toThrow(
        "content_reorder is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      await expect(getContentStats("project-1")).rejects.toThrow(
        "content_stats is retired until Workspace writes and Content CRUD move to App Server current methods",
      );

      expect(safeInvoke).not.toHaveBeenCalled();
    });
  });

  describe("isUserProjectType", () => {
    it("应该正确识别用户级项目类型", () => {
      expect(isUserProjectType("general")).toBe(true);
    });

    it("应该正确排除系统级类型", () => {
      expect(isUserProjectType("persistent")).toBe(false);
      expect(isUserProjectType("temporary")).toBe(false);
    });
  });

  describe("getProjectTypeLabel", () => {
    it("应该返回正确的项目类型标签", () => {
      const testCases: Array<[ProjectType, string]> = [
        ["persistent", "持久化"],
        ["temporary", "临时"],
        ["general", "通用对话"],
      ];

      testCases.forEach(([type, expected]) => {
        expect(getProjectTypeLabel(type)).toBe(expected);
      });
    });
  });

  describe("getProjectTypeIcon", () => {
    it("应该返回正确的项目类型图标", () => {
      const testCases: Array<[ProjectType, string]> = [
        ["persistent", "📁"],
        ["temporary", "📂"],
        ["general", "💬"],
      ];

      testCases.forEach(([type, expected]) => {
        expect(getProjectTypeIcon(type)).toBe(expected);
      });
    });
  });

  describe("getContentTypeLabel", () => {
    it("应该返回正确的内容类型标签", () => {
      const testCases: Array<[ContentType, string]> = [
        ["episode", "剧集"],
        ["chapter", "章节"],
        ["post", "帖子"],
        ["document", "文档"],
        ["content", "内容"],
      ];

      testCases.forEach(([type, expected]) => {
        expect(getContentTypeLabel(type)).toBe(expected);
      });
    });
  });

  describe("getContentStatusLabel", () => {
    it("应该返回正确的内容状态标签", () => {
      const testCases: Array<[ContentStatus, string]> = [
        ["draft", "草稿"],
        ["completed", "已完成"],
        ["published", "已发布"],
      ];

      testCases.forEach(([status, expected]) => {
        expect(getContentStatusLabel(status)).toBe(expected);
      });
    });
  });

  describe("getDefaultContentTypeForProject", () => {
    it("应该返回正确的默认内容类型映射", () => {
      const testCases: Array<[ProjectType, ContentType]> = [
        ["general", "content"],
        ["persistent", "document"],
        ["temporary", "document"],
      ];

      testCases.forEach(([type, expected]) => {
        expect(getDefaultContentTypeForProject(type)).toBe(expected);
      });
    });
  });

  describe("getCreateProjectErrorMessage", () => {
    it("应该返回默认错误信息", () => {
      expect(getCreateProjectErrorMessage("")).toBe("未知错误");
    });

    it("应该透传路径已存在错误", () => {
      expect(getCreateProjectErrorMessage("路径已存在: /tmp/project")).toBe(
        "项目目录已存在，请更换项目名称或清理同名目录",
      );
    });

    it("应该提示数据库迁移错误", () => {
      expect(getCreateProjectErrorMessage("no such column: icon")).toBe(
        "数据库结构过旧，请重启应用以执行迁移",
      );
      expect(getCreateProjectErrorMessage("has no column named icon")).toBe(
        "数据库结构过旧，请重启应用以执行迁移",
      );
    });

    it("应该提示目录无效", () => {
      expect(getCreateProjectErrorMessage("无效的路径")).toBe(
        "项目目录无效，请重新选择",
      );
    });

    it("应该处理对象错误字符串", () => {
      expect(getCreateProjectErrorMessage("[object Object]")).toBe(
        "创建项目失败，请查看日志",
      );
    });

    it("应该允许 UI 注入本地化友好错误文案", () => {
      const copy = {
        invalidPath: "Invalid project directory.",
        objectError: "Project creation failed. Check logs.",
        pathExists: "Project folder already exists.",
        staleSchema: "Database schema is outdated. Restart Lime.",
        unknown: "Unknown error.",
      };

      expect(getCreateProjectErrorMessage("", copy)).toBe("Unknown error.");
      expect(getCreateProjectErrorMessage("[object Object]", copy)).toBe(
        "Project creation failed. Check logs.",
      );
      expect(
        getCreateProjectErrorMessage("路径已存在: /tmp/project", copy),
      ).toBe("Project folder already exists.");
      expect(getCreateProjectErrorMessage("no such column: icon", copy)).toBe(
        "Database schema is outdated. Restart Lime.",
      );
      expect(getCreateProjectErrorMessage("无效的路径", copy)).toBe(
        "Invalid project directory.",
      );
    });
  });

  describe("extractErrorMessage", () => {
    it("应该提取 Error 实例 message", () => {
      expect(extractErrorMessage(new Error("abc"))).toBe("abc");
    });

    it("应该处理字符串错误", () => {
      expect(extractErrorMessage("hello")).toBe("hello");
    });

    it("应该处理对象 message 字段", () => {
      expect(extractErrorMessage({ message: "bad" })).toBe("bad");
    });

    it("应该兜底处理未知类型", () => {
      expect(extractErrorMessage(123)).toBe("123");
    });
  });

  describe("normalizeProject", () => {
    it("应该将 snake_case 字段转换为 camelCase", () => {
      const raw = {
        id: "1",
        name: "测试项目",
        workspace_type: "general" as ProjectType,
        root_path: "/tmp/project",
        is_default: true,
        created_at: 100,
        updated_at: 200,
        is_favorite: true,
        is_archived: false,
        tags: ["a"],
      };

      const result = normalizeProject(raw);

      expect(result.workspaceType).toBe("general");
      expect(result.rootPath).toBe("/tmp/project");
      expect(result.isDefault).toBe(true);
      expect(result.createdAt).toBe(100);
      expect(result.updatedAt).toBe(200);
      expect(result.isFavorite).toBe(true);
      expect(result.isArchived).toBe(false);
      expect(result.tags).toEqual(["a"]);
    });

    it("应该优先使用 camelCase 字段", () => {
      const raw = {
        id: "1",
        name: "测试项目",
        workspaceType: "general" as ProjectType,
        workspace_type: "general" as ProjectType,
        rootPath: "/tmp/document",
        root_path: "/tmp/video",
      };

      const result = normalizeProject(raw);
      expect(result.workspaceType).toBe("general");
      expect(result.rootPath).toBe("/tmp/document");
    });

    it("应该将旧主题类型归一到 general", () => {
      expect(
        normalizeProject({
          id: "legacy-poster",
          name: "旧海报项目",
          workspace_type: "poster",
        } as any).workspaceType,
      ).toBe("general");
      expect(
        normalizeProject({
          id: "legacy-music",
          name: "旧音乐项目",
          workspace_type: "music",
        } as any).workspaceType,
      ).toBe("general");
      expect(
        normalizeProject({
          id: "legacy-novel",
          name: "旧小说项目",
          workspace_type: "novel",
        } as any).workspaceType,
      ).toBe("general");
    });
  });

  describe("formatWordCount", () => {
    it("应该正确格式化小于 10000 的字数", () => {
      expect(formatWordCount(0)).toBe("0");
      expect(formatWordCount(100)).toBe("100");
      expect(formatWordCount(1000)).toBe("1,000");
      expect(formatWordCount(9999)).toBe("9,999");
    });

    it("应该正确格式化大于等于 10000 的字数", () => {
      expect(formatWordCount(10000)).toBe("1.0万");
      expect(formatWordCount(15000)).toBe("1.5万");
      expect(formatWordCount(100000)).toBe("10.0万");
      expect(formatWordCount(123456)).toBe("12.3万");
    });
  });

  describe("formatRelativeTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("应该返回 '刚刚' 对于不到 1 分钟前的时间", () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe("刚刚");
      expect(formatRelativeTime(now - 30 * 1000)).toBe("刚刚");
      expect(formatRelativeTime(now - 59 * 1000)).toBe("刚刚");
    });

    it("应该返回分钟数对于 1-59 分钟前的时间", () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60 * 1000)).toBe("1分钟前");
      expect(formatRelativeTime(now - 5 * 60 * 1000)).toBe("5分钟前");
      expect(formatRelativeTime(now - 59 * 60 * 1000)).toBe("59分钟前");
    });

    it("应该返回小时数对于 1-23 小时前的时间", () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60 * 60 * 1000)).toBe("1小时前");
      expect(formatRelativeTime(now - 5 * 60 * 60 * 1000)).toBe("5小时前");
      expect(formatRelativeTime(now - 23 * 60 * 60 * 1000)).toBe("23小时前");
    });

    it("应该返回天数对于 1-6 天前的时间", () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 24 * 60 * 60 * 1000)).toBe("1天前");
      expect(formatRelativeTime(now - 3 * 24 * 60 * 60 * 1000)).toBe("3天前");
      expect(formatRelativeTime(now - 6 * 24 * 60 * 60 * 1000)).toBe("6天前");
    });

    it("应该返回周数对于 1-4 周前的时间", () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 7 * 24 * 60 * 60 * 1000)).toBe("1周前");
      expect(formatRelativeTime(now - 14 * 24 * 60 * 60 * 1000)).toBe("2周前");
      expect(formatRelativeTime(now - 28 * 24 * 60 * 60 * 1000)).toBe("4周前");
    });

    it("应该返回日期对于超过 1 个月前的时间", () => {
      const now = Date.now();
      const result = formatRelativeTime(now - 31 * 24 * 60 * 60 * 1000);
      // 返回的是本地化日期字符串
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}\/\d{1,2}\/\d{1,2}/);
    });
  });
});

// ============================================================================
// CreateProjectRequest 验证测试
// ============================================================================

describe("CreateProjectRequest 验证", () => {
  it("应该包含必需的字段", () => {
    const request = {
      name: "测试项目",
      rootPath: "/path/to/project",
      workspaceType: "general" as ProjectType,
    };

    expect(request.name).toBeDefined();
    expect(request.rootPath).toBeDefined();
    expect(request.workspaceType).toBeDefined();
  });

  it("workspaceType 应该是可选的", () => {
    const request = {
      name: "测试项目",
      rootPath: "/path/to/project",
    };

    expect(request.name).toBeDefined();
    expect(request.rootPath).toBeDefined();
    expect(request).not.toHaveProperty("workspaceType");
  });
});

// ============================================================================
// UpdateProjectRequest 验证测试
// ============================================================================

describe("UpdateProjectRequest 验证", () => {
  it("所有字段应该是可选的", () => {
    const request = {};

    expect(request).not.toHaveProperty("name");
    expect(request).not.toHaveProperty("icon");
    expect(request).not.toHaveProperty("color");
    expect(request).not.toHaveProperty("isFavorite");
    expect(request).not.toHaveProperty("isArchived");
    expect(request).not.toHaveProperty("tags");
  });

  it("应该支持部分更新", () => {
    const request = {
      name: "新名称",
      isFavorite: true,
    };

    expect(request.name).toBe("新名称");
    expect(request.isFavorite).toBe(true);
    expect(request).not.toHaveProperty("icon");
  });
});

// ============================================================================
// CreateContentRequest 验证测试
// ============================================================================

describe("CreateContentRequest 验证", () => {
  it("应该包含必需的字段", () => {
    const request = {
      project_id: "project-123",
      title: "第一章",
    };

    expect(request.project_id).toBeDefined();
    expect(request.title).toBeDefined();
  });

  it("应该支持可选字段", () => {
    const request = {
      project_id: "project-123",
      title: "第一章",
      content_type: "chapter" as ContentType,
      order: 1,
      body: "内容正文",
      metadata: { key: "value" },
    };

    expect(request.content_type).toBe("chapter");
    expect(request.order).toBe(1);
    expect(request.body).toBe("内容正文");
    expect(request.metadata).toEqual({ key: "value" });
  });
});

// ============================================================================
// UpdateContentRequest 验证测试
// ============================================================================

describe("UpdateContentRequest 验证", () => {
  it("所有字段应该是可选的", () => {
    const request = {};

    expect(request).not.toHaveProperty("title");
    expect(request).not.toHaveProperty("status");
    expect(request).not.toHaveProperty("order");
    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("metadata");
    expect(request).not.toHaveProperty("session_id");
  });

  it("应该支持状态更新", () => {
    const request = {
      status: "completed" as ContentStatus,
    };

    expect(request.status).toBe("completed");
  });
});

// ============================================================================
// ListContentQuery 验证测试
// ============================================================================

describe("ListContentQuery 验证", () => {
  it("所有字段应该是可选的", () => {
    const query = {};

    expect(query).not.toHaveProperty("status");
    expect(query).not.toHaveProperty("content_type");
    expect(query).not.toHaveProperty("search");
    expect(query).not.toHaveProperty("sort_by");
    expect(query).not.toHaveProperty("sort_order");
    expect(query).not.toHaveProperty("offset");
    expect(query).not.toHaveProperty("limit");
  });

  it("应该支持分页参数", () => {
    const query = {
      offset: 10,
      limit: 20,
    };

    expect(query.offset).toBe(10);
    expect(query.limit).toBe(20);
  });

  it("应该支持排序参数", () => {
    const query = {
      sort_by: "created_at",
      sort_order: "desc" as const,
    };

    expect(query.sort_by).toBe("created_at");
    expect(query.sort_order).toBe("desc");
  });
});

// ============================================================================
// TYPE_CONFIGS 配置完整性测试
// ============================================================================

describe("TYPE_CONFIGS", () => {
  it("应该包含 current 主路径中的 3 种类型配置", () => {
    const allTypes: ProjectType[] = ["persistent", "temporary", "general"];
    allTypes.forEach((type) => {
      expect(TYPE_CONFIGS[type]).toBeDefined();
      expect(TYPE_CONFIGS[type].label).toBeTruthy();
      expect(TYPE_CONFIGS[type].icon).toBeTruthy();
      expect(TYPE_CONFIGS[type].defaultContentType).toBeTruthy();
    });
  });

  it("现役工作台类型不应再声明专用画布", () => {
    expect(TYPE_CONFIGS["general"].canvasType).toBeNull();
  });

  it("系统级类型不应该有画布", () => {
    expect(TYPE_CONFIGS["persistent"].canvasType).toBeNull();
    expect(TYPE_CONFIGS["temporary"].canvasType).toBeNull();
  });
});

// ============================================================================
// USER_PROJECT_TYPES 完整性测试
// ============================================================================

describe("USER_PROJECT_TYPES", () => {
  it("应该只保留 general", () => {
    expect(USER_PROJECT_TYPES).toHaveLength(1);
    expect(USER_PROJECT_TYPES).toContain("general");
  });

  it("不应该包含系统级类型", () => {
    expect(USER_PROJECT_TYPES).not.toContain("persistent");
    expect(USER_PROJECT_TYPES).not.toContain("temporary");
  });
});

// ============================================================================
// getCanvasTypeForProjectType 测试
// ============================================================================

describe("getCanvasTypeForProjectType", () => {
  it("不支持画布的类型应该返回 null", () => {
    expect(getCanvasTypeForProjectType("general")).toBeNull();
    expect(getCanvasTypeForProjectType("persistent")).toBeNull();
    expect(getCanvasTypeForProjectType("temporary")).toBeNull();
  });
});
