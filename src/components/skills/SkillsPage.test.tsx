import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SkillsPage,
} from "./SkillsPage";
import {
  filterSkillsByQueryAndStatus,
  groupSkillsBySourceKind,
} from "./skillsUtils";
import type { Skill } from "@/lib/api/skills";

const mockUseSkills = vi.fn();

vi.mock("@/hooks/useSkills", () => ({
  useSkills: (...args: unknown[]) => mockUseSkills(...args),
}));

vi.mock("./SkillContentDialog", () => ({
  SkillContentDialog: () => null,
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    key: "skill:test",
    name: "Test Skill",
    description: "A test skill",
    directory: "test-skill",
    installed: true,
    sourceKind: "other",
    ...overrides,
  };
}

function renderSkillsPage(): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<SkillsPage hideHeader />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseSkills.mockReturnValue({
    skills: [],
    repos: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
  });
});

afterEach(() => {
  mockUseSkills.mockReset();

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
});

describe("filterSkillsByQueryAndStatus", () => {
  it("应同时按搜索词和安装状态过滤技能", () => {
    const skills = [
      createSkill({ name: "Video Skill", installed: true }),
      createSkill({
        key: "skill:draft",
        name: "Draft Writer",
        directory: "draft-writer",
        installed: false,
      }),
    ];

    const result = filterSkillsByQueryAndStatus(skills, "draft", "uninstalled");
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Draft Writer");
  });
});

describe("groupSkillsBySourceKind", () => {
  it("应将技能分为内置、本地和远程三组", () => {
    const sections = groupSkillsBySourceKind([
      createSkill({
        key: "builtin:video_generate",
        name: "Video Generate",
        directory: "video_generate",
        sourceKind: "builtin",
      }),
      createSkill({
        key: "local:custom",
        name: "Custom Skill",
        directory: "custom-skill",
        sourceKind: "other",
      }),
      createSkill({
        key: "repo:remote",
        name: "Remote Skill",
        directory: "remote-skill",
        sourceKind: "other",
        repoOwner: "proxycast",
        repoName: "skills",
      }),
    ]);

    expect(sections[0]?.key).toBe("builtin");
    expect(sections[0]?.skills).toHaveLength(1);
    expect(sections[1]?.key).toBe("local");
    expect(sections[1]?.skills).toHaveLength(1);
    expect(sections[2]?.key).toBe("remote");
    expect(sections[2]?.skills).toHaveLength(1);
  });
});

describe("SkillsPage", () => {
  it("应按 Built-in / Local / Remote Skills 分组渲染，并隐藏内置技能卸载入口", () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "builtin:video_generate",
          name: "Video Generate",
          directory: "video_generate",
          sourceKind: "builtin",
        }),
        createSkill({
          key: "local:custom",
          name: "Local Skill",
          directory: "local-skill",
          sourceKind: "other",
          installed: false,
        }),
        createSkill({
          key: "repo:custom",
          name: "Remote Skill",
          directory: "remote-skill",
          repoOwner: "proxycast",
          repoName: "skills",
          sourceKind: "other",
        }),
      ],
      repos: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const text = container.textContent ?? "";

    expect(text).toContain("BUILT-IN SKILLS");
    expect(text).toContain("LOCAL SKILLS");
    expect(text).toContain("REMOTE SKILLS");
    expect(text.indexOf("BUILT-IN SKILLS")).toBeLessThan(
      text.indexOf("LOCAL SKILLS"),
    );
    expect(text.indexOf("LOCAL SKILLS")).toBeLessThan(
      text.indexOf("REMOTE SKILLS"),
    );

    const buttonTexts = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );
    const uninstallButtons = buttonTexts.filter((textContent) =>
      textContent.includes("卸载"),
    );

    expect(uninstallButtons).toHaveLength(1);
  });

  it("远程缓存为空时仍应显示远程分组和刷新提示", () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "builtin:video_generate",
          name: "Video Generate",
          directory: "video_generate",
          sourceKind: "builtin",
        }),
        createSkill({
          key: "local:custom",
          name: "Local Skill",
          directory: "local-skill",
          sourceKind: "other",
        }),
      ],
      repos: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const text = container.textContent ?? "";

    expect(text).toContain("REMOTE SKILLS");
    expect(text).toContain("暂无远程缓存");
    expect(text).toContain('点击"刷新"同步已启用仓库');
  });
});
