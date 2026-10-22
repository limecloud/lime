import { describe, expect, it } from "vitest";
import { areWorkspacePathsIdentical } from "./pathIdentity";

describe("workspace path identity", () => {
  it.each([
    [" /workspace/project/ ", "/workspace/project"],
    ["/workspace//project/./", "/workspace/project"],
    ["/", "/./"],
    ["c:\\Work\\Project\\", "C:/Work/Project"],
    ["C:/", "c:\\"],
    ["\\\\server\\share\\Project\\", "//server/share/Project"],
  ])("accepts equivalent absolute syntax: %s and %s", (left, right) => {
    expect(areWorkspacePathsIdentical(left, right)).toBe(true);
    expect(areWorkspacePathsIdentical(right, left)).toBe(true);
  });

  it.each([
    [undefined, undefined],
    [null, "/workspace"],
    ["", ""],
    ["project", "project"],
    ["~/project", "~/project"],
    ["C:project", "C:project"],
    ["file:///workspace", "file:///workspace"],
    ["/workspace/../project", "/workspace/../project"],
    ["/workspace/../project", "/project"],
    [String.raw`C:\Work\..\Project`, "C:/Project"],
    [String.raw`C:\Work\..\Project`, String.raw`C:\Work\..\Project`],
    [String.raw`\\server\share\..\Project`, "//server/Project"],
    ["/workspace/project", "/Workspace/project"],
    ["C:/Work/Project", "c:/work/Project"],
    ["//server/share/Project", "//SERVER/share/Project"],
    ["/workspace/project", "/other/workspace/project"],
    ["/workspace/project", "/workspace/project/child"],
    ["/workspace/project", "/workspace/project-other"],
    [String.raw`/workspace/a\b`, "/workspace/a/b"],
    ["/workspace/project", "C:/workspace/project"],
    [String.raw`\\?\C:\Work\Project`, "C:/Work/Project"],
    [String.raw`\\?\C:\Work\Project`, String.raw`\\?\C:\Work\Project`],
    [String.raw`\\?\UNC\server\share`, "//server/share"],
    ["//server", "//server"],
    ["/workspace\0/project", "/workspace\0/project"],
  ])("rejects unproven identity: %s and %s", (left, right) => {
    expect(areWorkspacePathsIdentical(left, right)).toBe(false);
    expect(areWorkspacePathsIdentical(right, left)).toBe(false);
  });
});
