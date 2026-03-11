import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteMaterial,
  getMaterialContent,
  getMaterialCount,
  importMaterialFromUrl,
  listMaterials,
  normalizeMaterial,
  updateMaterial,
  uploadMaterial,
} from "./materials";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("materials API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizeMaterial 应兼容 snake_case 并转换秒级时间戳", () => {
    const material = normalizeMaterial(
      {
        id: "m1",
        project_id: "project-1",
        material_type: "image",
        file_path: "/tmp/demo.png",
        file_size: 2048,
        mime_type: "image/png",
        created_at: 1_700_000_000,
      },
      "fallback-project",
    );

    expect(material).toEqual(
      expect.objectContaining({
        id: "m1",
        projectId: "project-1",
        type: "image",
        filePath: "/tmp/demo.png",
        fileSize: 2048,
        mimeType: "image/png",
        createdAt: 1_700_000_000_000,
      }),
    );
  });

  it("listMaterials 应返回规范化后的素材数组", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        id: "m1",
        project_id: "project-1",
        material_type: "image",
        file_path: "/tmp/demo.png",
      },
    ]);

    await expect(listMaterials("project-1")).resolves.toEqual([
      expect.objectContaining({
        id: "m1",
        projectId: "project-1",
        type: "image",
        filePath: "/tmp/demo.png",
      }),
    ]);

    expect(invoke).toHaveBeenCalledWith("list_materials", {
      projectId: "project-1",
      project_id: "project-1",
      filter: null,
    });
  });

  it("getMaterialCount 应调用统计命令", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(3);

    await expect(getMaterialCount("project-2")).resolves.toBe(3);
    expect(invoke).toHaveBeenCalledWith("get_material_count", {
      projectId: "project-2",
      project_id: "project-2",
    });
  });

  it("uploadMaterial 应发送兼容字段并规范化返回值", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "m2",
      project_id: "project-3",
      material_type: "image",
      file_path: "/tmp/upload.png",
    });

    await expect(
      uploadMaterial({
        projectId: "project-3",
        name: "upload.png",
        type: "image",
        filePath: "/tmp/upload.png",
        tags: ["demo"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "m2",
        projectId: "project-3",
        type: "image",
        filePath: "/tmp/upload.png",
      }),
    );

    expect(invoke).toHaveBeenCalledWith("upload_material", {
      req: expect.objectContaining({
        projectId: "project-3",
        project_id: "project-3",
        filePath: "/tmp/upload.png",
        file_path: "/tmp/upload.png",
      }),
    });
  });

  it("importMaterialFromUrl 应统一走网关请求格式", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "m3" });

    await expect(
      importMaterialFromUrl({
        projectId: "project-4",
        name: "remote-image",
        type: "image",
        url: "https://example.com/demo.png",
        tags: ["pixabay"],
      }),
    ).resolves.toEqual({ id: "m3" });

    expect(invoke).toHaveBeenCalledWith("import_material_from_url", {
      req: expect.objectContaining({
        projectId: "project-4",
        project_id: "project-4",
        url: "https://example.com/demo.png",
      }),
    });
  });

  it("updateMaterial / deleteMaterial / getMaterialContent 应代理到对应命令", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        id: "m4",
        projectId: "project-5",
        type: "text",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("hello");

    await expect(updateMaterial("m4", { name: "new-name" })).resolves.toEqual(
      expect.objectContaining({
        id: "m4",
        projectId: "project-5",
        type: "text",
      }),
    );
    await expect(deleteMaterial("m4")).resolves.toBeUndefined();
    await expect(getMaterialContent("m4")).resolves.toBe("hello");

    expect(invoke).toHaveBeenNthCalledWith(1, "update_material", {
      id: "m4",
      update: { name: "new-name" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "delete_material", {
      id: "m4",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "get_material_content", {
      id: "m4",
    });
  });
});
