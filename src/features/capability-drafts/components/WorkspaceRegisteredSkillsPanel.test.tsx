import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityDraftsApi } from "@/lib/api/capabilityDrafts";
import { WorkspaceRegisteredSkillsPanel } from "./WorkspaceRegisteredSkillsPanel";

vi.mock("@/lib/api/capabilityDrafts", () => ({
  capabilityDraftsApi: {
    listRegisteredSkills: vi.fn(),
  },
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderPanel(
  props?: Parameters<typeof WorkspaceRegisteredSkillsPanel>[0],
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkspaceRegisteredSkillsPanel {...props} />);
  });
  mountedRoots.push({ container, root });
  return { container, root };
}

describe("WorkspaceRegisteredSkillsPanel", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(capabilityDraftsApi.listRegisteredSkills).mockReset();
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
    vi.clearAllMocks();
  });

  it("没有项目根目录时只显示选择项目提示，不读取已注册能力", () => {
    const { container } = renderPanel();

    expect(container.textContent).toContain("Workspace 已注册能力");
    expect(container.textContent).toContain("选择或进入一个项目");
    expect(capabilityDraftsApi.listRegisteredSkills).not.toHaveBeenCalled();
  });

  it("应展示已注册能力来源和 runtime gate，且不提供运行入口", async () => {
    vi.mocked(capabilityDraftsApi.listRegisteredSkills).mockResolvedValueOnce([
      {
        key: "workspace:capability-report",
        name: "只读 CLI 报告",
        description: "把本地只读 CLI 输出整理成 Markdown 报告。",
        directory: "capability-report",
        registeredSkillDirectory: "/tmp/work/.agents/skills/capability-report",
        registration: {
          registrationId: "capreg-1",
          registeredAt: "2026-05-05T01:10:00.000Z",
          skillDirectory: "capability-report",
          registeredSkillDirectory:
            "/tmp/work/.agents/skills/capability-report",
          sourceDraftId: "capdraft-1",
          sourceVerificationReportId: "capver-1",
          generatedFileCount: 4,
          permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        },
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        metadata: {},
        allowedTools: [],
        resourceSummary: {
          hasScripts: true,
          hasReferences: false,
          hasAssets: false,
        },
        standardCompliance: {
          isStandard: true,
          validationErrors: [],
          deprecatedFields: [],
        },
        launchEnabled: false,
        runtimeGate:
          "已注册为 Workspace 本地 Skill 包；进入运行前还需要 P3B runtime binding 与 tool_runtime 授权。",
      },
    ]);

    const { container } = renderPanel({ workspaceRoot: "/tmp/work" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.listRegisteredSkills).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
    });
    expect(container.textContent).toContain("只读 CLI 报告");
    expect(container.textContent).toContain("已注册");
    expect(container.textContent).toContain("待 runtime gate");
    expect(container.textContent).toContain("capdraft-1 / capver-1");
    expect(container.textContent).toContain("Level 0 只读发现 / 允许执行本地 CLI");
    expect(container.textContent).toContain("scripts");
    expect(container.textContent).toContain("Agent Skills 标准通过");
    expect(container.textContent).toContain("tool_runtime 授权");
    expect(container.textContent).not.toContain("立即运行");
    expect(container.textContent).not.toContain("创建自动化");
    expect(container.textContent).not.toContain("继续这套方法");
  });

  it("refreshSignal 变化时应重新读取已注册能力", async () => {
    vi.mocked(capabilityDraftsApi.listRegisteredSkills)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          key: "workspace:capability-new",
          name: "新注册能力",
          description: "刷新后出现。",
          directory: "capability-new",
          registeredSkillDirectory: "/tmp/work/.agents/skills/capability-new",
          registration: {
            registrationId: "capreg-2",
            registeredAt: "2026-05-05T01:20:00.000Z",
            skillDirectory: "capability-new",
            registeredSkillDirectory:
              "/tmp/work/.agents/skills/capability-new",
            sourceDraftId: "capdraft-2",
            sourceVerificationReportId: "capver-2",
            generatedFileCount: 3,
            permissionSummary: ["Level 0 只读发现"],
          },
          permissionSummary: ["Level 0 只读发现"],
          metadata: {},
          allowedTools: [],
          resourceSummary: {
            hasScripts: false,
            hasReferences: false,
            hasAssets: false,
          },
          standardCompliance: {
            isStandard: true,
            validationErrors: [],
            deprecatedFields: [],
          },
          launchEnabled: false,
          runtimeGate: "等待 runtime gate。",
        },
      ]);

    const { container, root } = renderPanel({
      workspaceRoot: "/tmp/work",
      refreshSignal: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("当前项目还没有通过 P3A 注册的能力");

    await act(async () => {
      root.render(
        <WorkspaceRegisteredSkillsPanel
          workspaceRoot="/tmp/work"
          refreshSignal={1}
        />,
      );
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.listRegisteredSkills).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("新注册能力");
  });
});
