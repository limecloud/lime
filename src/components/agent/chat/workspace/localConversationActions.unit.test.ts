import { describe, expect, it } from "vitest";
import {
  availableEnvironmentActions,
  environmentActionCwd,
  environmentActionPlatform,
  orderEnvironmentActions,
} from "./localConversationActionHelpers";

describe("local conversation action projection", () => {
  it("ranks the first recent occurrence and preserves config identity and unranked order", () => {
    const actions = [
      { name: "Build", index: 0 },
      { name: "Test", index: 1 },
      { name: "Lint", index: 2 },
      { name: "Test", index: 3 },
    ];
    expect(
      orderEnvironmentActions(actions, ["Test", "Missing", "Build", "Test"]),
    ).toEqual([actions[1], actions[3], actions[0], actions[2]]);
    expect(orderEnvironmentActions(actions, [])).toEqual(actions);
    expect(orderEnvironmentActions(actions, ["Removed"])).toEqual(actions);
    expect(actions.map((action) => action.index)).toEqual([0, 1, 2, 3]);
  });
  it("filters actions by platform without changing configured order or command", () => {
    const actions = [
      { name: "All", command: "printf 'a b'" },
      { name: "Windows", command: "echo win", platform: "win32" as const },
      { name: "Mac", command: "echo mac", platform: "darwin" as const },
    ];
    expect(availableEnvironmentActions(actions, "darwin")).toEqual([
      actions[0],
      actions[2],
    ]);
    expect(availableEnvironmentActions(actions, null)).toEqual(actions);
    expect(environmentActionPlatform("Windows NT")).toBe("win32");
    expect(environmentActionPlatform("Macintosh; Intel Mac OS X")).toBe(
      "darwin",
    );
    expect(environmentActionPlatform("X11; Linux x86_64")).toBe("linux");
  });
  it.each([
    [
      {
        workspaceRoot: "/worktree/sub",
        repoRoot: "/worktree",
        relativePath: "packages/app",
      },
      "/worktree/packages/app",
    ],
    [
      {
        workspaceRoot: "/worktree/sub",
        repoRoot: "/worktree",
        relativePath: ".",
      },
      "/worktree",
    ],
    [
      {
        workspaceRoot: "C:\\trees\\sub",
        repoRoot: "C:\\trees",
        relativePath: "packages/app",
      },
      "C:\\trees\\packages\\app",
    ],
    [{ workspaceRoot: "/plain", repoRoot: null, relativePath: "." }, "/plain"],
  ])("resolves current checkout cwd: %j", (input, cwd) => {
    expect(environmentActionCwd(input)).toBe(cwd);
  });
});
