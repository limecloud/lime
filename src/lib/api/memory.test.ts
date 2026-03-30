import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  buildOutlineTree,
  createCharacter,
  createOutlineNode,
  deleteCharacter,
  deleteOutlineNode,
  getCharacter,
  getOutlineNode,
  getProjectMemory,
  getWorldBuilding,
  listCharacters,
  listOutlineNodes,
  updateCharacter,
  updateOutlineNode,
  updateWorldBuilding,
} from "./memory";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("memory API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理角色 CRUD 命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "c1", name: "角色1" }])
      .mockResolvedValueOnce({ id: "c1", name: "角色1" })
      .mockResolvedValueOnce({ id: "c2", name: "角色2" })
      .mockResolvedValueOnce({ id: "c2", name: "角色2-更新" })
      .mockResolvedValueOnce(true);

    await expect(listCharacters("project-1")).resolves.toEqual([
      expect.objectContaining({ id: "c1" }),
    ]);
    await expect(getCharacter("c1")).resolves.toEqual(
      expect.objectContaining({ id: "c1" }),
    );
    await expect(
      createCharacter({ project_id: "project-1", name: "角色2" }),
    ).resolves.toEqual(expect.objectContaining({ id: "c2" }));
    await expect(
      updateCharacter("c2", { name: "角色2-更新" }),
    ).resolves.toEqual(expect.objectContaining({ id: "c2" }));
    await expect(deleteCharacter("c2")).resolves.toBe(true);

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "character_list", {
      projectId: "project-1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "character_get", {
      id: "c1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "character_create", {
      request: { project_id: "project-1", name: "角色2" },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "character_update", {
      id: "c2",
      request: { name: "角色2-更新" },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(5, "character_delete", {
      id: "c2",
    });
  });

  it("应代理世界观命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ project_id: "project-1", description: "世界观" })
      .mockResolvedValueOnce({
        project_id: "project-1",
        description: "更新后的世界观",
      });

    await expect(getWorldBuilding("project-1")).resolves.toEqual(
      expect.objectContaining({ description: "世界观" }),
    );
    await expect(
      updateWorldBuilding("project-1", { description: "更新后的世界观" }),
    ).resolves.toEqual(
      expect.objectContaining({ description: "更新后的世界观" }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "world_building_get", {
      projectId: "project-1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "world_building_update", {
      projectId: "project-1",
      request: { description: "更新后的世界观" },
    });
  });

  it("应代理大纲与项目记忆命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "n1", title: "第一章", order: 1 }])
      .mockResolvedValueOnce({ id: "n1", title: "第一章", order: 1 })
      .mockResolvedValueOnce({ id: "n2", title: "第二章", order: 2 })
      .mockResolvedValueOnce({ id: "n2", title: "第二章-修订", order: 2 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        characters: [],
        outline: [],
      });

    await expect(listOutlineNodes("project-1")).resolves.toEqual([
      expect.objectContaining({ id: "n1" }),
    ]);
    await expect(getOutlineNode("n1")).resolves.toEqual(
      expect.objectContaining({ id: "n1" }),
    );
    await expect(
      createOutlineNode({ project_id: "project-1", title: "第二章" }),
    ).resolves.toEqual(expect.objectContaining({ id: "n2" }));
    await expect(
      updateOutlineNode("n2", { title: "第二章-修订" }),
    ).resolves.toEqual(expect.objectContaining({ id: "n2" }));
    await expect(deleteOutlineNode("n2")).resolves.toBe(true);
    await expect(getProjectMemory("project-1")).resolves.toEqual(
      expect.objectContaining({ characters: [], outline: [] }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "outline_node_list", {
      projectId: "project-1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "outline_node_get", {
      id: "n1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "outline_node_create", {
      request: { project_id: "project-1", title: "第二章" },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "outline_node_update", {
      id: "n2",
      request: { title: "第二章-修订" },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(5, "outline_node_delete", {
      id: "n2",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(6, "project_memory_get", {
      projectId: "project-1",
    });
  });

  it("应按父子关系和顺序构建大纲树", () => {
    const tree = buildOutlineTree([
      {
        id: "child-2",
        project_id: "p1",
        parent_id: "root-1",
        title: "子节点 2",
        order: 2,
        expanded: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "root-1",
        project_id: "p1",
        title: "根节点 1",
        order: 2,
        expanded: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "child-1",
        project_id: "p1",
        parent_id: "root-1",
        title: "子节点 1",
        order: 1,
        expanded: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "root-0",
        project_id: "p1",
        title: "根节点 0",
        order: 1,
        expanded: true,
        created_at: "",
        updated_at: "",
      },
    ]);

    expect(tree.map((node) => node.id)).toEqual(["root-0", "root-1"]);
    expect(tree[1].children.map((node) => node.id)).toEqual([
      "child-1",
      "child-2",
    ]);
  });
});
