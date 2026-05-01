import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  compileKnowledgePack,
  getKnowledgePack,
  importKnowledgeSource,
  listKnowledgePacks,
  resolveKnowledgeContext,
  setDefaultKnowledgePack,
  updateKnowledgePackStatus,
} from "./knowledge";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过统一网关代理知识包命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ packs: [] })
      .mockResolvedValueOnce({ metadata: { name: "sample-product" } })
      .mockResolvedValueOnce({ source: { relativePath: "sources/brief.md" } })
      .mockResolvedValueOnce({ selectedSourceCount: 1 })
      .mockResolvedValueOnce({ defaultPackName: "sample-product" })
      .mockResolvedValueOnce({
        pack: { metadata: { name: "sample-product", status: "ready" } },
        previousStatus: "needs-review",
        clearedDefault: false,
      })
      .mockResolvedValueOnce({
        packName: "sample-product",
        fencedContext:
          '<knowledge_pack name="sample-product"></knowledge_pack>',
        selectedViews: [],
        warnings: [],
        tokenEstimate: 1,
      });

    await expect(
      listKnowledgePacks({ workingDir: "/tmp/workspace" }),
    ).resolves.toEqual(expect.objectContaining({ packs: [] }));
    await expect(
      getKnowledgePack("/tmp/workspace", "sample-product"),
    ).resolves.toEqual(
      expect.objectContaining({ metadata: { name: "sample-product" } }),
    );
    await expect(
      importKnowledgeSource({
        workingDir: "/tmp/workspace",
        packName: "sample-product",
        sourceText: "示例产品事实",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ relativePath: "sources/brief.md" }),
      }),
    );
    await expect(
      compileKnowledgePack("/tmp/workspace", "sample-product"),
    ).resolves.toEqual(expect.objectContaining({ selectedSourceCount: 1 }));
    await expect(
      setDefaultKnowledgePack("/tmp/workspace", "sample-product"),
    ).resolves.toEqual(
      expect.objectContaining({ defaultPackName: "sample-product" }),
    );
    await expect(
      updateKnowledgePackStatus({
        workingDir: "/tmp/workspace",
        name: "sample-product",
        status: "ready",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        previousStatus: "needs-review",
        clearedDefault: false,
      }),
    );
    await expect(
      resolveKnowledgeContext({
        workingDir: "/tmp/workspace",
        name: "sample-product",
        task: "写产品介绍",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        fencedContext: expect.stringContaining("<knowledge_pack"),
      }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "knowledge_list_packs", {
      request: {
        workingDir: "/tmp/workspace",
      },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "knowledge_get_pack", {
      request: {
        workingDir: "/tmp/workspace",
        name: "sample-product",
      },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "knowledge_import_source", {
      request: {
        workingDir: "/tmp/workspace",
        packName: "sample-product",
        sourceText: "示例产品事实",
      },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "knowledge_compile_pack", {
      request: {
        workingDir: "/tmp/workspace",
        name: "sample-product",
      },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(
      5,
      "knowledge_set_default_pack",
      {
        request: {
          workingDir: "/tmp/workspace",
          name: "sample-product",
        },
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      6,
      "knowledge_update_pack_status",
      {
        request: {
          workingDir: "/tmp/workspace",
          name: "sample-product",
          status: "ready",
        },
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(7, "knowledge_resolve_context", {
      request: {
        workingDir: "/tmp/workspace",
        name: "sample-product",
        task: "写产品介绍",
      },
    });
  });
});
