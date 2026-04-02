import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceSettings } from "@/types/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamSelectorPanel } from "./TeamSelectorPanel";
import {
  createTeamDefinitionFromPreset,
  type TeamDefinition,
} from "../../../utils/teamDefinitions";

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderPanel(
  props?: Partial<ComponentProps<typeof TeamSelectorPanel>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: ComponentProps<typeof TeamSelectorPanel> = {
    onSelectTeam: vi.fn(),
  };

  act(() => {
    root.render(<TeamSelectorPanel {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return { container };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
  value: string,
) {
  if (!element) {
    throw new Error("未找到目标输入元素");
  }

  act(() => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("TeamSelectorPanel", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        break;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    localStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("不应再展示模型生成 Team 入口", async () => {
    const { container } = renderPanel();

    await flushEffects();

    expect(container.textContent).not.toContain("模型生成 Team");
  });

  it("应保存自定义 Team 的 profileId、roleKey 与 skillIds", async () => {
    const onSelectTeam = vi.fn();
    const selectedTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const { container } = renderPanel({
      selectedTeam,
      onSelectTeam,
    });

    await flushEffects();

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("新建自定义 Team"),
    );

    expect(createButton).toBeTruthy();

    act(() => {
      createButton?.click();
    });

    await flushEffects();

    setInputValue(
      container.querySelector(
        '[data-testid="team-role-profile-select-0"]',
      ) as HTMLSelectElement | null,
      "research-analyst",
    );
    setInputValue(
      container.querySelector(
        '[data-testid="team-role-role-key-input-0"]',
      ) as HTMLInputElement | null,
      "research-lead",
    );
    setInputValue(
      container.querySelector(
        '[data-testid="team-role-skill-ids-input-0"]',
      ) as HTMLInputElement | null,
      "source-grounding, structured-writing",
    );

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存 Team"),
    );

    expect(saveButton).toBeTruthy();

    act(() => {
      saveButton?.click();
    });

    await flushEffects();

    const savedTeam = onSelectTeam.mock.calls[0]?.[0] as TeamDefinition | undefined;

    expect(savedTeam).toBeTruthy();
    expect(savedTeam?.source).toBe("custom");
    expect(savedTeam?.roles[0]?.profileId).toBe("research-analyst");
    expect(savedTeam?.roles[0]?.roleKey).toBe("research-lead");
    expect(savedTeam?.roles[0]?.skillIds).toEqual([
      "source-grounding",
      "structured-writing",
    ]);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("项目级自定义 Team 应通过回调持久化", async () => {
    const onPersistCustomTeams = vi.fn().mockResolvedValue(undefined);
    const workspaceSettings: WorkspaceSettings = {
      agentTeam: {
        customTeams: [
          {
            id: "custom-team-project-1",
            label: "项目联调 Team",
            description: "面向当前项目的联调与修复。",
            roles: [
              {
                id: "planner",
                label: "分析",
                summary: "先定位问题再拆解实施。",
              },
            ],
          },
        ],
      },
    };
    const { container } = renderPanel({
      workspaceSettings,
      onPersistCustomTeams,
    });

    await flushEffects();

    expect(container.textContent).toContain("项目联调 Team");
    expect(container.textContent).toContain("当前项目 Team");

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("删除这个 Team"),
    );

    expect(deleteButton).toBeTruthy();

    act(() => {
      deleteButton?.click();
    });

    await flushEffects();

    expect(onPersistCustomTeams).toHaveBeenCalledWith([]);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("命中稳妥模式模型时不应再展示 Team 横幅提示", async () => {
    const { container } = renderPanel({
      providerType: "openai",
      model: "glm-4.7",
    });

    await flushEffects();

    expect(
      container.querySelector(
        '[data-testid="team-selector-stable-processing-notice"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("稳妥模式");
  });
});
