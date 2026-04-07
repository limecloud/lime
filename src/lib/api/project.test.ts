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
  normalizeProject,
  formatWordCount,
  formatRelativeTime,
  TYPE_CONFIGS,
  USER_PROJECT_TYPES,
  type ProjectType,
  type ContentType,
  type ContentStatus,
} from "./project";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

// ============================================================================
// 辅助函数测试
// ============================================================================

describe("项目管理 API", () => {
  describe("workspace 路径 API", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("应该调用命令获取 workspace 根目录", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce("/Users/test/.lime/projects");

      const root = await getWorkspaceProjectsRoot();

      expect(root).toBe("/Users/test/.lime/projects");
      expect(safeInvoke).toHaveBeenCalledWith("workspace_get_projects_root");
    });

    it("应该调用命令解析项目目录", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(
        "/Users/test/.lime/projects/MyProject",
      );

      const path = await resolveProjectRootPath("MyProject");

      expect(path).toBe("/Users/test/.lime/projects/MyProject");
      expect(safeInvoke).toHaveBeenCalledWith(
        "workspace_resolve_project_path",
        {
          name: "MyProject",
        },
      );
    });

    it("应该将空名称传给后端统一处理", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(
        "/Users/test/.lime/projects/未命名项目",
      );

      const path = await resolveProjectRootPath("   ");

      expect(path).toBe("/Users/test/.lime/projects/未命名项目");
      expect(safeInvoke).toHaveBeenCalledWith(
        "workspace_resolve_project_path",
        {
          name: "   ",
        },
      );
    });

    it("应该调用命令按路径获取项目", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce({
        id: "p1",
        name: "测试项目",
        workspace_type: "general",
        root_path: "/Users/test/.lime/projects/demo",
      });

      const project = await getProjectByRootPath(
        "/Users/test/.lime/projects/demo",
      );

      expect(project?.id).toBe("p1");
      expect(project?.rootPath).toBe("/Users/test/.lime/projects/demo");
      expect(safeInvoke).toHaveBeenCalledWith("workspace_get_by_path", {
        rootPath: "/Users/test/.lime/projects/demo",
      });
    });

    it("按路径查询不存在项目时应该返回 null", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      const project = await getProjectByRootPath(
        "/Users/test/.lime/projects/missing",
      );

      expect(project).toBeNull();
    });

    it("应该获取并标准化默认项目", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce({
        id: "default-1",
        name: "默认项目",
        workspace_type: "general",
        root_path: "/Users/test/.lime/projects/default",
        is_default: true,
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
      expect(safeInvoke).toHaveBeenCalledWith("workspace_get_default");
    });

    it("requireDefaultProject 缺失默认项目时应抛指定错误", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await expect(requireDefaultProject("请先创建默认项目")).rejects.toThrow(
        "请先创建默认项目",
      );
    });

    it("requireDefaultProjectId 应返回默认项目 ID", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce({
        id: "default-2",
        name: "默认项目 2",
      });

      await expect(requireDefaultProjectId()).resolves.toBe("default-2");
    });

    it("应该调用命令确保默认项目目录就绪", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce({
        workspaceId: "default-3",
        rootPath: "/tmp/default-3",
        existed: true,
        created: false,
        repaired: true,
      });

      await expect(ensureWorkspaceReady("default-3")).resolves.toEqual({
        workspaceId: "default-3",
        rootPath: "/tmp/default-3",
        existed: true,
        created: false,
        repaired: true,
      });
      expect(safeInvoke).toHaveBeenCalledWith("workspace_ensure_ready", {
        id: "default-3",
      });
    });

    it("应该调用命令确保默认项目目录就绪并支持空返回", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await expect(ensureDefaultWorkspaceReady()).resolves.toBeNull();
      expect(safeInvoke).toHaveBeenCalledWith("workspace_ensure_default_ready");
    });

    it("应该调用命令设置默认项目", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

      await expect(setDefaultProject("default-4")).resolves.toBeUndefined();
      expect(safeInvoke).toHaveBeenCalledWith("workspace_set_default", {
        id: "default-4",
      });
    });

    it("应该代理项目 CRUD 相关命令", async () => {
      vi.mocked(safeInvoke)
        .mockResolvedValueOnce({
          id: "project-1",
          name: "项目 1",
          workspace_type: "general",
          root_path: "/tmp/project-1",
        })
        .mockResolvedValueOnce([
          {
            id: "project-1",
            name: "项目 1",
            workspace_type: "general",
            root_path: "/tmp/project-1",
          },
        ])
        .mockResolvedValueOnce({
          id: "default-5",
          name: "默认项目 5",
          workspace_type: "general",
          root_path: "/tmp/default-5",
        })
        .mockResolvedValueOnce({
          id: "project-1",
          name: "项目 1",
          workspace_type: "general",
          root_path: "/tmp/project-1",
        })
        .mockResolvedValueOnce({
          id: "project-1",
          name: "项目 1-更新",
          workspace_type: "general",
          root_path: "/tmp/project-1",
        })
        .mockResolvedValueOnce(true);

      await expect(
        createProject({
          name: "项目 1",
          rootPath: "/tmp/project-1",
          workspaceType: "general",
        }),
      ).resolves.toEqual(expect.objectContaining({ id: "project-1" }));
      await expect(listProjects()).resolves.toEqual([
        expect.objectContaining({ id: "project-1" }),
      ]);
      await expect(getOrCreateDefaultProject()).resolves.toEqual(
        expect.objectContaining({ id: "default-5" }),
      );
      await expect(getProject("project-1")).resolves.toEqual(
        expect.objectContaining({ id: "project-1" }),
      );
      await expect(
        updateProject("project-1", { name: "项目 1-更新" }),
      ).resolves.toEqual(expect.objectContaining({ name: "项目 1-更新" }));
      await expect(deleteProject("project-1", true)).resolves.toBe(true);

      expect(safeInvoke).toHaveBeenNthCalledWith(1, "workspace_create", {
        request: {
          name: "项目 1",
          rootPath: "/tmp/project-1",
          workspaceType: "general",
        },
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(2, "workspace_list");
      expect(safeInvoke).toHaveBeenNthCalledWith(
        3,
        "get_or_create_default_project",
      );
      expect(safeInvoke).toHaveBeenNthCalledWith(4, "workspace_get", {
        id: "project-1",
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(5, "workspace_update", {
        id: "project-1",
        request: { name: "项目 1-更新" },
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(6, "workspace_delete", {
        id: "project-1",
        deleteDirectory: true,
      });
    });

    it("应该代理内容相关命令", async () => {
      vi.mocked(safeInvoke)
        .mockResolvedValueOnce({
          id: "content-1",
          project_id: "project-1",
          title: "第一章",
          content_type: "chapter",
          status: "draft",
          order: 1,
          word_count: 10,
          created_at: 1,
          updated_at: 2,
          body: "内容",
        })
        .mockResolvedValueOnce({
          id: "content-1",
          project_id: "project-1",
          title: "第一章",
          content_type: "chapter",
          status: "draft",
          order: 1,
          word_count: 10,
          created_at: 1,
          updated_at: 2,
          body: "内容",
        })
        .mockResolvedValueOnce({
          content_id: "content-1",
          current_version_id: "v1",
          version_count: 1,
          versions: [],
        })
        .mockResolvedValueOnce([
          {
            id: "content-1",
            project_id: "project-1",
            title: "第一章",
            content_type: "chapter",
            status: "draft",
            order: 1,
            word_count: 10,
            created_at: 1,
            updated_at: 2,
          },
        ])
        .mockResolvedValueOnce({
          id: "content-1",
          project_id: "project-1",
          title: "第一章-修订",
          content_type: "chapter",
          status: "completed",
          order: 1,
          word_count: 20,
          created_at: 1,
          updated_at: 3,
          body: "内容",
        })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([1, 2, 3]);

      await expect(
        createContent({
          project_id: "project-1",
          title: "第一章",
          content_type: "chapter",
        }),
      ).resolves.toEqual(expect.objectContaining({ id: "content-1" }));
      await expect(getContent("content-1")).resolves.toEqual(
        expect.objectContaining({ id: "content-1" }),
      );
      await expect(
        getGeneralWorkbenchDocumentState("content-1"),
      ).resolves.toEqual(expect.objectContaining({ current_version_id: "v1" }));
      await expect(
        listContents("project-1", { content_type: "chapter" }),
      ).resolves.toEqual([expect.objectContaining({ id: "content-1" })]);
      await expect(
        updateContent("content-1", {
          title: "第一章-修订",
          status: "completed",
        }),
      ).resolves.toEqual(expect.objectContaining({ title: "第一章-修订" }));
      await expect(deleteContent("content-1")).resolves.toBe(true);
      await expect(
        reorderContents("project-1", ["content-1"]),
      ).resolves.toBeUndefined();
      await expect(getContentStats("project-1")).resolves.toEqual([1, 2, 3]);

      expect(safeInvoke).toHaveBeenNthCalledWith(1, "content_create", {
        request: {
          project_id: "project-1",
          title: "第一章",
          content_type: "chapter",
        },
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(2, "content_get", {
        id: "content-1",
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(
        3,
        "content_get_general_workbench_document_state",
        { id: "content-1" },
      );
      expect(safeInvoke).toHaveBeenNthCalledWith(4, "content_list", {
        projectId: "project-1",
        query: { content_type: "chapter" },
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(5, "content_update", {
        id: "content-1",
        request: { title: "第一章-修订", status: "completed" },
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(6, "content_delete", {
        id: "content-1",
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(7, "content_reorder", {
        projectId: "project-1",
        contentIds: ["content-1"],
      });
      expect(safeInvoke).toHaveBeenNthCalledWith(8, "content_stats", {
        projectId: "project-1",
      });
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
