import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createGalleryMetadata,
  deleteGalleryMetadata,
  getGalleryMaterial,
  listGalleryMaterialsByImageCategory,
  listGalleryMaterialsByLayoutCategory,
  listGalleryMaterialsByMood,
  updateGalleryMetadata,
} from "./galleryMaterials";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("galleryMaterials API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取单个素材", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ id: "m1", type: "image" });

    await expect(getGalleryMaterial("m1")).resolves.toEqual(
      expect.objectContaining({ id: "m1" }),
    );
    expect(safeInvoke).toHaveBeenCalledWith("get_gallery_material", {
      materialId: "m1",
    });
  });

  it("应代理素材元数据写操作", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ materialId: "m2" })
      .mockResolvedValueOnce({ materialId: "m2" })
      .mockResolvedValueOnce(undefined);

    await expect(
      createGalleryMetadata({
        materialId: "m2",
        colors: ["#fff"],
      }),
    ).resolves.toEqual(expect.objectContaining({ materialId: "m2" }));
    await expect(
      updateGalleryMetadata("m2", {
        materialId: "m2",
        colors: ["#000"],
      }),
    ).resolves.toEqual(expect.objectContaining({ materialId: "m2" }));
    await expect(deleteGalleryMetadata("m2")).resolves.toBeUndefined();
  });

  it("应代理不同维度的素材查询", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "img-1" }])
      .mockResolvedValueOnce([{ id: "layout-1" }])
      .mockResolvedValueOnce([{ id: "color-1" }]);

    await expect(
      listGalleryMaterialsByImageCategory("project-1", "background"),
    ).resolves.toEqual([expect.objectContaining({ id: "img-1" })]);
    await expect(
      listGalleryMaterialsByLayoutCategory("project-1", "grid"),
    ).resolves.toEqual([expect.objectContaining({ id: "layout-1" })]);
    await expect(
      listGalleryMaterialsByMood("project-1", "warm"),
    ).resolves.toEqual([expect.objectContaining({ id: "color-1" })]);
  });
});
