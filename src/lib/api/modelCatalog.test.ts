import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { getAvailableModels } from "./modelCatalog";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("modelCatalog API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理模型列表命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      { id: "gpt-4.1", object: "model", owned_by: "openai" },
    ]);

    await expect(getAvailableModels()).resolves.toEqual([
      expect.objectContaining({ id: "gpt-4.1" }),
    ]);
  });
});
