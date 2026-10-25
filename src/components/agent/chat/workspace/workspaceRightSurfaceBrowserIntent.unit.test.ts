import { describe, expect, it } from "vitest";
import type { WorkspaceRightSurfacePendingRequest } from "@/lib/api/workspaceRightSurface";
import { buildWorkspaceRightSurfacePendingBrowserIntent } from "./workspaceRightSurfaceBrowserIntent";

const basePending: WorkspaceRightSurfacePendingRequest = {
  requestId: "right_surface_browser_1",
  surfaceKind: "browser",
  origin: "runtime",
  priority: "foreground",
  status: "pending",
  requestedAt: "2026-06-24T00:00:00.000Z",
};

describe("workspaceRightSurfaceBrowserIntent", () => {
  it("身份分配不打开面板，工具前台请求选择已挂载页面且不再次导航", () => {
    const identity = { ...basePending, reason: "browser_identity_tool" };
    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([identity]),
    ).toBeNull();
    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([
        identity,
        {
          ...basePending,
          requestId: "reveal",
          reason: "browser_tool",
          metadata: { browser: { tabId: "primary" } },
        },
      ]),
    ).toMatchObject({
      sourceRequestId: "reveal",
      priority: "foreground",
      tabId: "primary",
      launchUrl: null,
    });
  });
  it("应从 browser pending metadata 中解析可见浏览器 intent", () => {
    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([
        {
          ...basePending,
          reason: "browser_requirement",
          metadata: {
            browser: {
              launchUrl: "https://example.com/editor",
              title: "Example Editor",
            },
          },
        },
      ]),
    ).toEqual({
      source: "rightSurfacePending",
      sourceRequestId: "right_surface_browser_1",
      origin: "runtime",
      reason: "browser_requirement",
      priority: "foreground",
      launchUrl: "https://example.com/editor",
      title: "Example Editor",
    });
  });

  it("只在 candidateId 像可导航目标时才作为 launchUrl fallback", () => {
    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([
        {
          ...basePending,
          requestId: "right_surface_browser_2",
          priority: "normal",
          candidateId: "example.com/path",
          metadata: {
            browser: { title: "Candidate URL" },
          },
        },
      ]),
    ).toMatchObject({
      sourceRequestId: "right_surface_browser_2",
      priority: "background",
      launchUrl: "example.com/path",
      title: "Candidate URL",
    });

    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([
        {
          ...basePending,
          candidateId: "browser-session-id",
          metadata: {
            browser: { title: "Session Only" },
          },
        },
      ]),
    ).toMatchObject({
      launchUrl: null,
      title: "Session Only",
    });
  });

  it("非 pending browser 请求不生成 intent", () => {
    expect(
      buildWorkspaceRightSurfacePendingBrowserIntent([
        {
          ...basePending,
          surfaceKind: "files",
        },
        {
          ...basePending,
          status: "consumed",
        },
      ]),
    ).toBeNull();
  });
});
