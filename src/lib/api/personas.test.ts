import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createPersona,
  deletePersona,
  getDefaultPersona,
  listPersonaTemplates,
  listPersonas,
  setDefaultPersona,
  updatePersona,
} from "./personas";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("personas API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取人设列表、默认人设和模板列表", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "p1", name: "人设 1" }])
      .mockResolvedValueOnce({ id: "p1", name: "人设 1" })
      .mockResolvedValueOnce([{ id: "pt1", name: "模板人设" }]);

    await expect(listPersonas("project-1")).resolves.toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
    await expect(getDefaultPersona("project-1")).resolves.toEqual(
      expect.objectContaining({ id: "p1" }),
    );
    await expect(listPersonaTemplates()).resolves.toEqual([
      expect.objectContaining({ id: "pt1" }),
    ]);
  });

  it("应代理人设写操作", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ id: "p2", name: "人设 2" })
      .mockResolvedValueOnce({ id: "p2", name: "人设 2-更新" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      createPersona({
        projectId: "project-2",
        name: "人设 2",
        style: "稳重",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "p2" }));
    await expect(updatePersona("p2", { tone: "克制" })).resolves.toEqual(
      expect.objectContaining({ id: "p2" }),
    );
    await expect(deletePersona("p2")).resolves.toBeUndefined();
    await expect(setDefaultPersona("project-2", "p2")).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, "create_persona", {
      req: expect.objectContaining({ projectId: "project-2" }),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "update_persona", {
      id: "p2",
      update: { tone: "克制" },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "delete_persona", { id: "p2" });
    expect(invoke).toHaveBeenNthCalledWith(4, "set_default_persona", {
      projectId: "project-2",
      personaId: "p2",
    });
  });
});
