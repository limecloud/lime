import { describe, expect, it } from "vitest";
import { normalizeManagedWorkspacePathForDisplay } from "./workspacePath";

describe("workspacePath", () => {
  it("应将 macOS 下的 .proxycast 项目目录规范到 lime app data", () => {
    expect(
      normalizeManagedWorkspacePathForDisplay(
        "/Users/coso/.proxycast/projects/default/exports/demo",
      ),
    ).toBe(
      "/Users/coso/Library/Application Support/lime/projects/default/exports/demo",
    );
  });

  it("应将 macOS 下的旧 app data 项目目录规范到 lime app data", () => {
    expect(
      normalizeManagedWorkspacePathForDisplay(
        "/Users/coso/Library/Application Support/proxycast/projects/default",
      ),
    ).toBe("/Users/coso/Library/Application Support/lime/projects/default");
  });

  it("不应改写外部自定义项目目录", () => {
    expect(normalizeManagedWorkspacePathForDisplay("/tmp/custom-project")).toBe(
      "/tmp/custom-project",
    );
  });
});
