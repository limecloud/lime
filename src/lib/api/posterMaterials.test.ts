import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createPosterMetadata,
  deletePosterMetadata,
  getPosterMaterial,
  listPosterMaterialsByImageCategory,
  listPosterMaterialsByLayoutCategory,
  listPosterMaterialsByMood,
  updatePosterMetadata,
} from "./posterMaterials";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("posterMaterials API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取单个海报素材", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "m1", type: "image" });

    await expect(getPosterMaterial("m1")).resolves.toEqual(
      expect.objectContaining({ id: "m1" }),
    );
    expect(invoke).toHaveBeenCalledWith("get_poster_material", {
      materialId: "m1",
    });
  });

  it("应代理海报素材元数据写操作", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ materialId: "m2" })
      .mockResolvedValueOnce({ materialId: "m2" })
      .mockResolvedValueOnce(undefined);

    await expect(
      createPosterMetadata({
        materialId: "m2",
        colors: ["#fff"],
      }),
    ).resolves.toEqual(expect.objectContaining({ materialId: "m2" }));
    await expect(
      updatePosterMetadata("m2", {
        materialId: "m2",
        colors: ["#000"],
      }),
    ).resolves.toEqual(expect.objectContaining({ materialId: "m2" }));
    await expect(deletePosterMetadata("m2")).resolves.toBeUndefined();
  });

  it("应代理不同维度的海报素材查询", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "img-1" }])
      .mockResolvedValueOnce([{ id: "layout-1" }])
      .mockResolvedValueOnce([{ id: "color-1" }]);

    await expect(
      listPosterMaterialsByImageCategory("project-1", "background"),
    ).resolves.toEqual([expect.objectContaining({ id: "img-1" })]);
    await expect(
      listPosterMaterialsByLayoutCategory("project-1", "grid"),
    ).resolves.toEqual([expect.objectContaining({ id: "layout-1" })]);
    await expect(
      listPosterMaterialsByMood("project-1", "warm"),
    ).resolves.toEqual([expect.objectContaining({ id: "color-1" })]);
  });
});
