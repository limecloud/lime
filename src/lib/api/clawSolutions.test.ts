import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import {
  checkClawSolutionReadiness,
  getClawSolutionDetail,
  listClawSolutions,
  prepareClawSolution,
} from "./clawSolutions";

afterEach(() => {
  vi.clearAllMocks();
});

describe("clawSolutions api", () => {
  it("应调用 claw_solution_list", async () => {
    mockSafeInvoke.mockResolvedValueOnce([]);

    await listClawSolutions();

    expect(mockSafeInvoke).toHaveBeenCalledWith("claw_solution_list");
  });

  it("应调用 claw_solution_detail", async () => {
    mockSafeInvoke.mockResolvedValueOnce(null);

    await getClawSolutionDetail("social-post-starter");

    expect(mockSafeInvoke).toHaveBeenCalledWith("claw_solution_detail", {
      solutionId: "social-post-starter",
    });
  });

  it("应调用 claw_solution_check_readiness", async () => {
    mockSafeInvoke.mockResolvedValueOnce(null);

    await checkClawSolutionReadiness("browser-assist-task", {
      userInput: "帮我登录后台",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "claw_solution_check_readiness",
      {
        solutionId: "browser-assist-task",
        context: {
          userInput: "帮我登录后台",
        },
      },
    );
  });

  it("应调用 claw_solution_prepare", async () => {
    mockSafeInvoke.mockResolvedValueOnce(null);

    await prepareClawSolution("team-breakdown", {
      projectId: "project-1",
      userInput: "拆解季度增长方案",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("claw_solution_prepare", {
      solutionId: "team-breakdown",
      context: {
        projectId: "project-1",
        userInput: "拆解季度增长方案",
      },
    });
  });
});
