import { describe, expect, it } from "vitest";
import {
  availableEnvironmentActions,
  environmentActionCwd,
  environmentActionPlatform,
} from "./localConversationActionHelpers";

describe("local conversation action projection", () => {
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
