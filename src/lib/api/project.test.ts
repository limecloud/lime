/**
 * @file 项目管理 API 测试
 * @description 测试项目（Project）和内容（Content）的 API 功能
 * @module lib/api/project.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  ensureWorkspaceReady,
  ensureDefaultWorkspaceReady,
  getWorkspaceProjectsRoot,
  resolveProjectRootPath,
  getProjectByRootPath,
  getDefaultProject,
  requireDefaultProject,
  requireDefaultProjectId,
  setDefaultProject,
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
      vi.mocked(invoke).mockResolvedValueOnce(
        "/Users/test/.proxycast/projects",
      );

      const root = await getWorkspaceProjectsRoot();

      expect(root).toBe("/Users/test/.proxycast/projects");
      expect(invoke).toHaveBeenCalledWith("workspace_get_projects_root");
    });

    it("应该调用命令解析项目目录", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(
        "/Users/test/.proxycast/projects/MyProject",
      );

      const path = await resolveProjectRootPath("MyProject");

      expect(path).toBe("/Users/test/.proxycast/projects/MyProject");
      expect(invoke).toHaveBeenCalledWith("workspace_resolve_project_path", {
        name: "MyProject",
      });
    });

    it("应该将空名称传给后端统一处理", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(
        "/Users/test/.proxycast/projects/未命名项目",
      );

      const path = await resolveProjectRootPath("   ");

      expect(path).toBe("/Users/test/.proxycast/projects/未命名项目");
      expect(invoke).toHaveBeenCalledWith("workspace_resolve_project_path", {
        name: "   ",
      });
    });

    it("应该调用命令按路径获取项目", async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        id: "p1",
        name: "测试项目",
        workspace_type: "general",
        root_path: "/Users/test/.proxycast/projects/demo",
      });

      const project = await getProjectByRootPath(
        "/Users/test/.proxycast/projects/demo",
      );

      expect(project?.id).toBe("p1");
      expect(project?.rootPath).toBe("/Users/test/.proxycast/projects/demo");
      expect(invoke).toHaveBeenCalledWith("workspace_get_by_path", {
        rootPath: "/Users/test/.proxycast/projects/demo",
      });
    });

    it("按路径查询不存在项目时应该返回 null", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      const project = await getProjectByRootPath(
        "/Users/test/.proxycast/projects/missing",
      );

      expect(project).toBeNull();
    });

    it("应该获取并标准化默认项目", async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        id: "default-1",
        name: "默认项目",
        workspace_type: "general",
        root_path: "/Users/test/.proxycast/projects/default",
        is_default: true,
      });

      const project = await getDefaultProject();

      expect(project).toEqual(
        expect.objectContaining({
          id: "default-1",
          name: "默认项目",
          workspaceType: "general",
          rootPath: "/Users/test/.proxycast/projects/default",
          isDefault: true,
        }),
      );
      expect(invoke).toHaveBeenCalledWith("workspace_get_default");
    });

    it("requireDefaultProject 缺失默认项目时应抛指定错误", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      await expect(requireDefaultProject("请先创建默认项目")).rejects.toThrow(
        "请先创建默认项目",
      );
    });

    it("requireDefaultProjectId 应返回默认项目 ID", async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        id: "default-2",
        name: "默认项目 2",
      });

      await expect(requireDefaultProjectId()).resolves.toBe("default-2");
    });

    it("应该调用命令确保默认项目目录就绪", async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
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
      expect(invoke).toHaveBeenCalledWith("workspace_ensure_ready", {
        id: "default-3",
      });
    });

    it("应该调用命令确保默认项目目录就绪并支持空返回", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      await expect(ensureDefaultWorkspaceReady()).resolves.toBeNull();
      expect(invoke).toHaveBeenCalledWith("workspace_ensure_default_ready");
    });

    it("应该调用命令设置默认项目", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await expect(setDefaultProject("default-4")).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledWith("workspace_set_default", {
        id: "default-4",
      });
    });
  });

  describe("isUserProjectType", () => {
    it("应该正确识别用户级项目类型", () => {
      expect(isUserProjectType("general")).toBe(true);
      expect(isUserProjectType("social-media")).toBe(true);
      expect(isUserProjectType("poster")).toBe(true);
      expect(isUserProjectType("music")).toBe(true);
      expect(isUserProjectType("knowledge")).toBe(true);
      expect(isUserProjectType("planning")).toBe(true);
      expect(isUserProjectType("document")).toBe(true);
      expect(isUserProjectType("video")).toBe(true);
      expect(isUserProjectType("novel")).toBe(true);
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
        ["social-media", "社媒内容"],
        ["poster", "图文海报"],
        ["music", "歌词曲谱"],
        ["knowledge", "知识探索"],
        ["planning", "计划规划"],
        ["document", "办公文档"],
        ["video", "短视频"],
        ["novel", "小说创作"],
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
        ["social-media", "📱"],
        ["poster", "🖼️"],
        ["music", "🎵"],
        ["knowledge", "🔍"],
        ["planning", "📅"],
        ["document", "📄"],
        ["video", "🎬"],
        ["novel", "📖"],
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
        ["video", "episode"],
        ["novel", "chapter"],
        ["social-media", "post"],
        ["document", "document"],
        ["general", "content"],
        ["persistent", "document"],
        ["temporary", "document"],
        ["poster", "document"],
        ["music", "document"],
        ["knowledge", "document"],
        ["planning", "document"],
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
        workspace_type: "video" as ProjectType,
        root_path: "/tmp/project",
        is_default: true,
        created_at: 100,
        updated_at: 200,
        is_favorite: true,
        is_archived: false,
        tags: ["a"],
      };

      const result = normalizeProject(raw);

      expect(result.workspaceType).toBe("video");
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
        workspaceType: "novel" as ProjectType,
        workspace_type: "video" as ProjectType,
        rootPath: "/tmp/novel",
        root_path: "/tmp/video",
      };

      const result = normalizeProject(raw);
      expect(result.workspaceType).toBe("novel");
      expect(result.rootPath).toBe("/tmp/novel");
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
      workspaceType: "video" as ProjectType,
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
  it("应该包含所有 11 种类型的配置", () => {
    const allTypes: ProjectType[] = [
      "persistent",
      "temporary",
      "general",
      "social-media",
      "poster",
      "music",
      "knowledge",
      "planning",
      "document",
      "video",
      "novel",
    ];
    allTypes.forEach((type) => {
      expect(TYPE_CONFIGS[type]).toBeDefined();
      expect(TYPE_CONFIGS[type].label).toBeTruthy();
      expect(TYPE_CONFIGS[type].icon).toBeTruthy();
      expect(TYPE_CONFIGS[type].defaultContentType).toBeTruthy();
    });
  });

  it("每种类型的画布配置应该正确", () => {
    expect(TYPE_CONFIGS["video"].canvasType).toBe("script");
    expect(TYPE_CONFIGS["novel"].canvasType).toBe("novel");
    expect(TYPE_CONFIGS["poster"].canvasType).toBe("poster");
    expect(TYPE_CONFIGS["music"].canvasType).toBe("music");
    expect(TYPE_CONFIGS["general"].canvasType).toBeNull();
  });

  it("系统级类型不应该有画布", () => {
    expect(TYPE_CONFIGS["persistent"].canvasType).toBeNull();
    expect(TYPE_CONFIGS["temporary"].canvasType).toBeNull();
  });

  it("文档类型应该使用 document 画布", () => {
    expect(TYPE_CONFIGS["document"].canvasType).toBe("document");
    expect(TYPE_CONFIGS["social-media"].canvasType).toBe("document");
  });
});

// ============================================================================
// USER_PROJECT_TYPES 完整性测试
// ============================================================================

describe("USER_PROJECT_TYPES", () => {
  it("应该包含 9 种用户级类型", () => {
    expect(USER_PROJECT_TYPES).toHaveLength(9);
    expect(USER_PROJECT_TYPES).toContain("general");
    expect(USER_PROJECT_TYPES).toContain("social-media");
    expect(USER_PROJECT_TYPES).toContain("poster");
    expect(USER_PROJECT_TYPES).toContain("music");
    expect(USER_PROJECT_TYPES).toContain("knowledge");
    expect(USER_PROJECT_TYPES).toContain("planning");
    expect(USER_PROJECT_TYPES).toContain("document");
    expect(USER_PROJECT_TYPES).toContain("video");
    expect(USER_PROJECT_TYPES).toContain("novel");
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
  it("应该返回正确的画布类型", () => {
    expect(getCanvasTypeForProjectType("video")).toBe("script");
    expect(getCanvasTypeForProjectType("novel")).toBe("novel");
    expect(getCanvasTypeForProjectType("poster")).toBe("poster");
    expect(getCanvasTypeForProjectType("music")).toBe("music");
    expect(getCanvasTypeForProjectType("social-media")).toBe("document");
    expect(getCanvasTypeForProjectType("document")).toBe("document");
  });

  it("不支持画布的类型应该返回 null", () => {
    expect(getCanvasTypeForProjectType("general")).toBeNull();
    expect(getCanvasTypeForProjectType("knowledge")).toBeNull();
    expect(getCanvasTypeForProjectType("planning")).toBeNull();
    expect(getCanvasTypeForProjectType("persistent")).toBeNull();
    expect(getCanvasTypeForProjectType("temporary")).toBeNull();
  });
});
