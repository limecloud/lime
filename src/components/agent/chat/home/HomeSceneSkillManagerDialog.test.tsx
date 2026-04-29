import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSceneSkillManagerDialog } from "./HomeSceneSkillManagerDialog";
import type { SkillCatalog } from "@/lib/api/skillCatalog";

const {
  mockGetClientSceneSkillPreferences,
  mockUpdateClientSceneSkillPreferences,
  mockGetSkillCatalog,
  mockRefreshSkillCatalogFromRemote,
} = vi.hoisted(() => ({
  mockGetClientSceneSkillPreferences: vi.fn(),
  mockUpdateClientSceneSkillPreferences: vi.fn(),
  mockGetSkillCatalog: vi.fn(),
  mockRefreshSkillCatalogFromRemote: vi.fn(),
}));

vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => ({
    baseUrl: "https://cloud.lime.test",
    controlPlaneBaseUrl: "https://cloud.lime.test/api",
    sceneBaseUrl: "https://cloud.lime.test/scene-api",
    gatewayBaseUrl: "https://cloud.lime.test/gateway-api",
    tenantId: "tenant-0001",
    sessionToken: "session-token",
    hubProviderName: null,
    loginPath: "/login",
    desktopClientId: "desktop-client",
    desktopOauthRedirectUrl: "lime://oauth/callback",
    desktopOauthNextPath: "/welcome",
  }),
  hasOemCloudSession: () => true,
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  getClientSceneSkillPreferences: mockGetClientSceneSkillPreferences,
  updateClientSceneSkillPreferences: mockUpdateClientSceneSkillPreferences,
}));

vi.mock("@/lib/api/skillCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/skillCatalog")>();
  return {
    ...actual,
    getSkillCatalog: mockGetSkillCatalog,
    refreshSkillCatalogFromRemote: mockRefreshSkillCatalogFromRemote,
  };
});

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildCatalog(): SkillCatalog {
  return {
    version: "test",
    tenantId: "tenant-0001",
    syncedAt: "2026-04-30T00:00:00Z",
    groups: [],
    items: [],
    entries: [
      {
        id: "skill:service-skill-0005",
        kind: "skill",
        title: "趋势简报",
        summary: "整理平台趋势。",
        skillId: "service-skill-0005",
        groupKey: "general",
        execution: { kind: "automation_job" },
      },
      {
        id: "command:image_generate",
        kind: "command",
        title: "配图",
        summary: "生成图片。",
        commandKey: "image_generate",
        triggers: [{ mode: "mention", prefix: "@配图" }],
      },
    ],
  };
}

function renderDialog() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  act(() => {
    root.render(<HomeSceneSkillManagerDialog open onClose={vi.fn()} />);
  });
  return container;
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetSkillCatalog.mockResolvedValue(buildCatalog());
  mockGetClientSceneSkillPreferences.mockResolvedValue({
    tenantId: "tenant-0001",
    userId: "user-0001",
    orderedEntryIds: ["skill:service-skill-0005"],
    hiddenEntryIds: [],
    customScenes: [],
    updatedAt: "2026-04-30T00:00:00Z",
  });
  mockUpdateClientSceneSkillPreferences.mockResolvedValue({});
  mockRefreshSkillCatalogFromRemote.mockResolvedValue(buildCatalog());
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("HomeSceneSkillManagerDialog", () => {
  it("保存显隐和排序到云端偏好", async () => {
    const container = renderDialog();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.click();
    });
    const done = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "完成",
    );
    expect(done).toBeTruthy();

    await act(async () => {
      done?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUpdateClientSceneSkillPreferences).toHaveBeenCalledWith(
      "tenant-0001",
      expect.objectContaining({
        orderedEntryIds: ["skill:service-skill-0005"],
        hiddenEntryIds: ["skill:service-skill-0005"],
      }),
    );
    expect(mockRefreshSkillCatalogFromRemote).toHaveBeenCalledTimes(1);
  });

  it("新增自定义场景时要求绑定已有 SkillCatalog entry", async () => {
    const container = renderDialog();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "新增场景",
    );
    act(() => {
      add?.click();
    });

    const inputs = container.querySelectorAll("input");
    const select = container.querySelector("select");
    const textarea = container.querySelector("textarea");
    act(() => {
      setInputValue(inputs[0], "每日复盘");
      if (select) {
        setSelectValue(select, "skill:service-skill-0005");
      }
      if (textarea) {
        setInputValue(textarea, "请帮我复盘今天的内容表现。");
      }
    });

    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "加入列表",
    );
    act(() => {
      submit?.click();
    });

    expect(container.textContent).toContain("每日复盘");
  });
});
