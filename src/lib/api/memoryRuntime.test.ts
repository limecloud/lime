import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  analyzeContextMemory,
  cleanupContextMemdir,
  cleanupContextMemory,
  getContextMemoryAutoIndex,
  getContextMemoryEffectiveSources,
  getContextMemoryExtractionStatus,
  getContextMemoryOverview,
  getContextMemoryStats,
  getContextWorkingMemory,
  ensureWorkspaceLocalAgentsGitignore,
  prefetchContextMemoryForTurn,
  scaffoldContextMemdir,
  scaffoldRuntimeAgentsTemplate,
  toggleContextMemoryAuto,
  updateContextMemoryAutoNote,
} from "./memoryRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("memoryRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过 context memory 命名代理记忆查询命令", async () => {
    vi.mocked(safeInvoke).mockImplementation(async (command) => {
      switch (command) {
        case "memory_runtime_get_stats":
          return {
            total_entries: 1,
            storage_used: 2,
            memory_count: 3,
          };
        case "memory_runtime_request_analysis":
          return { analyzed_sessions: 1 };
        case "memory_runtime_cleanup":
          return { cleaned_entries: 1, freed_space: 2 };
        case "memory_runtime_get_working_memory":
          return { sessions: [], total_entries: 0, total_sessions: 0 };
        case "memory_runtime_get_extraction_status":
          return { status: "idle", recent_compactions: [] };
        case "memory_runtime_prefetch_for_turn":
          return { session_id: "session-1", durable_memories: [] };
        case "memory_runtime_get_overview":
          return { stats: {}, categories: [], entries: [] };
        case "memory_get_effective_sources":
          return { sources: [] };
        case "memory_get_auto_index":
          return { items: [] };
        case "memory_scaffold_memdir":
          return { files: [], root_dir: "/tmp/workspace/memory" };
        case "memory_scaffold_runtime_agents_template":
          return { status: "created", path: "/tmp/.lime/AGENTS.md" };
        case "memory_ensure_workspace_local_agents_gitignore":
          return { status: "added", path: "/tmp/.gitignore" };
        default:
          return null;
      }
    });

    await expect(getContextMemoryStats()).resolves.toEqual(
      expect.objectContaining({ total_entries: 1 }),
    );
    await expect(analyzeContextMemory()).resolves.toEqual(
      expect.objectContaining({ analyzed_sessions: 1 }),
    );
    await expect(cleanupContextMemory()).resolves.toEqual(
      expect.objectContaining({ cleaned_entries: 1 }),
    );
    await expect(getContextWorkingMemory("session-1", 10)).resolves.toEqual(
      expect.objectContaining({ sessions: [] }),
    );
    await expect(getContextMemoryExtractionStatus()).resolves.toEqual(
      expect.objectContaining({ status: "idle" }),
    );
    await expect(
      prefetchContextMemoryForTurn({ session_id: "session-1" }),
    ).resolves.toEqual(expect.objectContaining({ session_id: "session-1" }));
    await expect(getContextMemoryOverview(200)).resolves.toEqual(
      expect.objectContaining({ entries: [] }),
    );
    await expect(getContextMemoryEffectiveSources()).resolves.toEqual(
      expect.objectContaining({ sources: [] }),
    );
    await expect(getContextMemoryAutoIndex()).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
    await expect(scaffoldContextMemdir("/tmp/workspace")).resolves.toEqual(
      expect.objectContaining({ root_dir: "/tmp/workspace/memory" }),
    );
    await expect(
      scaffoldRuntimeAgentsTemplate("workspace", "/tmp/workspace"),
    ).resolves.toEqual(expect.objectContaining({ status: "created" }));
    await expect(
      ensureWorkspaceLocalAgentsGitignore("/tmp/workspace"),
    ).resolves.toEqual(expect.objectContaining({ status: "added" }));

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "memory_runtime_get_stats");
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "memory_runtime_request_analysis",
      {
        fromTimestamp: undefined,
        toTimestamp: undefined,
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "memory_runtime_cleanup");
    expect(safeInvoke).toHaveBeenNthCalledWith(
      4,
      "memory_runtime_get_working_memory",
      {
        limit: 10,
        sessionId: "session-1",
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      5,
      "memory_runtime_get_extraction_status",
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      6,
      "memory_runtime_prefetch_for_turn",
      {
        request: {
          session_id: "session-1",
        },
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      7,
      "memory_runtime_get_overview",
      {
        limit: 200,
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      8,
      "memory_get_effective_sources",
      {
        activeRelativePath: undefined,
        workingDir: undefined,
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(9, "memory_get_auto_index", {
      workingDir: undefined,
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(10, "memory_scaffold_memdir", {
      overwrite: undefined,
      workingDir: "/tmp/workspace",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(
      11,
      "memory_scaffold_runtime_agents_template",
      {
        overwrite: undefined,
        target: "workspace",
        workingDir: "/tmp/workspace",
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      12,
      "memory_ensure_workspace_local_agents_gitignore",
      {
        workingDir: "/tmp/workspace",
      },
    );
  });

  it("应暴露清晰的 context memory 命名", async () => {
    vi.mocked(safeInvoke).mockImplementation(async (command) => {
      switch (command) {
        case "memory_runtime_get_stats":
          return { total_entries: 9 };
        case "memory_runtime_request_analysis":
          return { analyzed_sessions: 3 };
        case "memory_runtime_cleanup":
          return { cleaned_entries: 4 };
        case "memory_runtime_get_working_memory":
          return { sessions: [], total_entries: 0, total_sessions: 0 };
        case "memory_runtime_get_extraction_status":
          return { status: "ready", recent_compactions: [] };
        case "memory_runtime_prefetch_for_turn":
          return { session_id: "session-2", durable_memories: [] };
        case "memory_runtime_get_overview":
          return { stats: {}, categories: [], entries: [] };
        case "memory_get_effective_sources":
          return { sources: [] };
        case "memory_get_auto_index":
          return { items: [] };
        case "memory_toggle_auto":
          return { enabled: true };
        case "memory_update_auto_note":
          return { items: [] };
        case "memory_cleanup_memdir":
          return { updated_files: 1 };
        case "memory_scaffold_memdir":
          return { files: [], root_dir: "/tmp/workspace/memory" };
        case "memory_scaffold_runtime_agents_template":
          return { status: "exists", path: "/tmp/.lime/AGENTS.md" };
        case "memory_ensure_workspace_local_agents_gitignore":
          return { status: "exists", path: "/tmp/.gitignore" };
        default:
          return null;
      }
    });

    await expect(getContextMemoryStats()).resolves.toEqual(
      expect.objectContaining({ total_entries: 9 }),
    );
    await expect(analyzeContextMemory()).resolves.toEqual(
      expect.objectContaining({ analyzed_sessions: 3 }),
    );
    await expect(cleanupContextMemory()).resolves.toEqual(
      expect.objectContaining({ cleaned_entries: 4 }),
    );
    await expect(getContextWorkingMemory()).resolves.toEqual(
      expect.objectContaining({ sessions: [] }),
    );
    await expect(getContextMemoryExtractionStatus()).resolves.toEqual(
      expect.objectContaining({ status: "ready" }),
    );
    await expect(
      prefetchContextMemoryForTurn({ session_id: "session-2" }),
    ).resolves.toEqual(expect.objectContaining({ session_id: "session-2" }));
    await expect(getContextMemoryOverview()).resolves.toEqual(
      expect.objectContaining({ entries: [] }),
    );
    await expect(getContextMemoryEffectiveSources()).resolves.toEqual(
      expect.objectContaining({ sources: [] }),
    );
    await expect(getContextMemoryAutoIndex()).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
    await expect(toggleContextMemoryAuto(true)).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(updateContextMemoryAutoNote("note")).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
    await expect(cleanupContextMemdir("/tmp/workspace")).resolves.toEqual(
      expect.objectContaining({ updated_files: 1 }),
    );
    await expect(scaffoldContextMemdir("/tmp/workspace")).resolves.toEqual(
      expect.objectContaining({ root_dir: "/tmp/workspace/memory" }),
    );
    await expect(scaffoldRuntimeAgentsTemplate("global")).resolves.toEqual(
      expect.objectContaining({ status: "exists" }),
    );
    await expect(
      ensureWorkspaceLocalAgentsGitignore("/tmp/workspace"),
    ).resolves.toEqual(expect.objectContaining({ status: "exists" }));
  });

  it("应代理 context memory 自动记忆开关与写入命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ updated_files: 1 });

    await expect(toggleContextMemoryAuto(true)).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(
      updateContextMemoryAutoNote("note", "topic", undefined, "feedback"),
    ).resolves.toEqual(expect.objectContaining({ items: [] }));

    expect(safeInvoke).toHaveBeenNthCalledWith(2, "memory_update_auto_note", {
      memoryType: "feedback",
      note: "note",
      topic: "topic",
      workingDir: undefined,
    });
    await expect(cleanupContextMemdir("/tmp/workspace")).resolves.toEqual(
      expect.objectContaining({ updated_files: 1 }),
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "memory_cleanup_memdir", {
      workingDir: "/tmp/workspace",
    });
  });
});
