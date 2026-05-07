import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { skillsApi } from "./skills";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("skillsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("浏览器 fallback 未返回本地技能数组时应回退为空列表", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(skillsApi.getLocal("lime")).resolves.toEqual([]);
    expect(safeInvoke).toHaveBeenCalledWith("get_local_skills_for_app", {
      app: "lime",
    });
  });

  it("远端技能列表应继续归一化标准检查字段", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([
      {
        key: "local:writer",
        name: "写作助手",
        description: "测试技能",
        directory: "writer",
        installed: true,
        sourceKind: "other",
        standardCompliance: {
          isStandard: true,
        },
      },
    ]);

    await expect(skillsApi.getAll("lime")).resolves.toEqual([
      expect.objectContaining({
        key: "local:writer",
        standardCompliance: {
          isStandard: true,
          validationErrors: [],
          deprecatedFields: [],
        },
      }),
    ]);
  });

  it("仓库列表与已安装目录列表缺失时也不应抛错", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(null);

    await expect(skillsApi.getRepos()).resolves.toEqual([]);
    await expect(skillsApi.getInstalledLimeSkills()).resolves.toEqual([]);
  });
});
