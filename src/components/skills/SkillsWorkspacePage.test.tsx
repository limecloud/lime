import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRegisteredSkillRecord } from "@/lib/api/capabilityDrafts";
import {
  clickMenuItem,
  findButton,
  findButtonIn,
  findLocalSkillRow,
  findMarketplaceCard,
  getLatestNavigationPayload,
  mocks,
  openLocalSkillMenu,
  renderPage,
  useSkillsWorkspacePageTestLifecycle,
} from "./SkillsWorkspacePage.testFixtures";

describe("SkillsWorkspacePage", () => {
  useSkillsWorkspacePageTestLifecycle();

  it("应按分页隔离技能广场、内置、用户安装", () => {
    const { container } = renderPage();

    expect(
      container.querySelector('[data-testid="skills-store-view"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="skills-builtin-view"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeNull();
    expect(container.textContent).toContain("技能广场");
    expect(container.textContent).toContain("官方精选");
    expect(container.textContent).toContain("数据分析");
    expect(container.textContent).not.toContain("深度研究");
    expect(container.textContent).not.toContain("写作助手");
    expect(
      findButtonIn(findMarketplaceCard(container, "数据分析")!, "卸载"),
    ).toBeUndefined();

    act(() => {
      findButton(container, "内置")?.click();
    });

    expect(
      container.querySelector('[data-testid="skills-store-view"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="skills-builtin-view"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("ASP.NET Core");
    expect(container.textContent).toContain("自动加载");
    expect(container.textContent).not.toContain("写作助手");
    expect(container.textContent).not.toContain("卸载");

    act(() => {
      findButton(container, "用户安装")?.click();
    });

    expect(
      container.querySelector('[data-testid="skills-builtin-view"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("写作助手");
    expect(container.textContent).toContain("自动加载");
    openLocalSkillMenu(container);
    expect(container.textContent).toContain("在聊天中试用");
    expect(container.textContent).toContain("重命名");
    expect(container.textContent).toContain("替换");
    expect(container.textContent).toContain("在文件夹中显示");
    expect(container.textContent).toContain("卸载");
    expect(container.textContent).not.toContain("ASP.NET Core");
  });

  it("页面壳、卡片和详情弹窗应接入 Lime 主题变量", async () => {
    const { container } = renderPage();
    const shell = container.querySelector(".lime-workbench-theme-scope");
    const card = findMarketplaceCard(container, "数据分析");

    expect(shell?.className).toContain("bg-[color:var(--lime-app-bg)]");
    expect(shell?.querySelector("main")?.className).toContain(
      "bg-[color:var(--lime-surface)]",
    );
    expect(card?.className).toContain("bg-[color:var(--lime-surface)]");
    expect(card?.className).toContain(
      "border-[color:var(--lime-surface-border)]",
    );

    await act(async () => {
      findButtonIn(card!, "详情")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const detail = container.querySelector(
      '[data-testid="skills-marketplace-detail"]',
    );
    const dialogScope = detail?.closest(".lime-workbench-theme-scope");

    expect(dialogScope?.className).toContain("lime-workbench-surface-scope");
    expect(dialogScope?.className).toContain("bg-[color:var(--lime-surface)]");
  });

  it("用户安装页点击使用应回首页输入框预选 canonical 技能，不显示入口横幅", async () => {
    const { container, onNavigate } = renderPage();

    act(() => {
      findButton(container, "用户安装")?.click();
    });
    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "在聊天中试用");
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        preferHomeForInitialInputCapability: true,
        initialInputCapability: {
          skill: expect.objectContaining({
            key: "local:writer",
            name: "写作助手",
          }),
          requestKey: expect.any(Number),
        },
      }),
    );
    expect(getLatestNavigationPayload(onNavigate)).not.toHaveProperty(
      "entryBannerMessage",
    );
  });

  it("使用技能时保留 runtime catalog 的 canonical name、显示名与路径", async () => {
    const local = mocks.localSkills.find(
      (skill) => skill.key === "local:writer",
    )!;
    local.localDirectoryPath = "/skills/writer";
    const canonical = {
      ...local,
      key: "user:writer",
      name: "writer",
      displayName: "写作助手",
    };
    mocks.getRuntimeCatalog.mockResolvedValueOnce([canonical]);
    const { container, onNavigate } = renderPage({ initialView: "installed" });
    openLocalSkillMenu(container);
    await act(async () => clickMenuItem(container, "在聊天中试用"));
    expect(
      getLatestNavigationPayload(onNavigate)?.initialInputCapability,
    ).toMatchObject({ skill: canonical });
  });

  it.each(["missing", "ambiguous", "unavailable"])(
    "runtime Skill %s 时显示错误，不生成 fallback 输入",
    async (mode) => {
      const local = mocks.localSkills.find(
        (skill) => skill.key === "local:writer",
      )!;
      if (mode === "unavailable")
        mocks.getRuntimeCatalog.mockRejectedValueOnce(
          new Error("catalog unavailable"),
        );
      else
        mocks.getRuntimeCatalog.mockResolvedValueOnce(
          mode === "missing" ? [] : [local, { ...local }],
        );
      const { container, onNavigate } = renderPage({
        initialView: "installed",
      });
      openLocalSkillMenu(container);
      await act(async () => clickMenuItem(container, "在聊天中试用"));
      expect(onNavigate).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledOnce();
    },
  );

  it("用户安装页首屏不等待已保存技能面板", () => {
    const { container } = renderPage({ initialView: "installed" });

    expect(container.textContent).toContain("写作助手");
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.listRegisteredSkills).not.toHaveBeenCalled();
    expect(mocks.listWorkspaceSkillBindings).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '[data-testid="workspace-registered-skills-panel"]',
      ),
    ).toBeNull();
  });

  it("初始搜索参数应进入用户安装页并过滤目标技能", () => {
    const { container } = renderPage({
      initialView: "installed",
      initialSearchQuery: "writer",
      initialSearchRequestKey: 1,
    });
    const searchInput = container.querySelector<HTMLInputElement>("input");

    expect(searchInput?.value).toBe("writer");
    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("写作助手");
    expect(container.textContent).not.toContain("ASP.NET Core");
  });

  it("初始脚手架草稿应进入用户安装页并打开创建对话框", () => {
    const { container } = renderPage({
      initialView: "installed",
      initialScaffoldDraft: {
        target: "project",
        directory: "project-report",
        name: "项目报告",
        description: "沉淀为可注册的工作区技能。",
      },
      initialScaffoldRequestKey: 2,
    });
    const scaffoldDialog = container.querySelector(
      '[data-testid="skill-scaffold-dialog"]',
    );

    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();
    expect(scaffoldDialog?.textContent).toContain("project-report");
    expect(scaffoldDialog?.textContent).toContain("项目报告");
    expect(scaffoldDialog?.textContent).toContain("沉淀为可注册的工作区技能。");
  });

  it("项目级脚手架创建后应刷新已保存技能和 workspace binding readiness", async () => {
    const savedSkill: WorkspaceRegisteredSkillRecord = {
      key: "workspace:project-report",
      name: "项目报告",
      description: "沉淀为可注册的工作区技能。",
      directory: "project-report",
      registeredSkillDirectory:
        "/Users/demo/Lime/default-workspace/.agents/skills/project-report",
      registration: {
        registrationId: "skill-scaffold-project-report",
        registeredAt: "2026-06-23T00:00:00.000Z",
        skillDirectory: "project-report",
        registeredSkillDirectory:
          "/Users/demo/Lime/default-workspace/.agents/skills/project-report",
        sourceDraftId: "skill-scaffold",
        sourceVerificationReportId: "skill-scaffold-create",
        generatedFileCount: 1,
        permissionSummary: [],
        verificationGates: [],
        approvalRequests: [],
      },
      permissionSummary: [],
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
      runtimeGate: "等待手动启用",
    };
    vi.useFakeTimers();
    mocks.listRegisteredSkills
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([savedSkill]);
    mocks.listWorkspaceSkillBindings
      .mockResolvedValueOnce({ bindings: [] })
      .mockResolvedValueOnce({
        bindings: [
          {
            key: "workspace_skill:project-report",
            name: "项目报告",
            description: "沉淀为可注册的工作区技能。",
            directory: "project-report",
            registered_skill_directory:
              "/Users/demo/Lime/default-workspace/.agents/skills/project-report",
            registration: {
              sourceVerificationReportId: "skill-scaffold-create",
            },
            permission_summary: [],
            metadata: {},
            allowed_tools: [],
            resource_summary: {
              has_scripts: false,
              has_references: false,
              has_assets: false,
            },
            standard_compliance: {
              is_standard: true,
              validation_errors: [],
              deprecated_fields: [],
            },
            runtime_binding_target: "workspace_skill",
            binding_status: "ready_for_manual_enable",
            binding_status_reason: "已具备 runtime binding 候选资格。",
            next_gate: "manual_runtime_enable",
            query_loop_visible: false,
            tool_runtime_visible: false,
            launch_enabled: false,
            runtime_gate: "等待 P3E 显式启用。",
          },
        ],
      });
    mocks.createSkillScaffold.mockResolvedValueOnce({
      content: "# 项目报告",
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
    });

    try {
      const { container } = renderPage({
        initialView: "installed",
        creationProjectId: "default-workspace",
        initialScaffoldDraft: {
          target: "project",
          directory: "project-report",
          name: "项目报告",
          description: "沉淀为可注册的工作区技能。",
        },
        initialScaffoldRequestKey: 3,
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.listWorkspaceSkillBindings).toHaveBeenCalledTimes(1);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="skill-scaffold-create"]',
          )
          ?.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.createSkillScaffold).toHaveBeenCalledWith(
        {
          target: "project",
          directory: "project-report",
          name: "项目报告",
          description: "沉淀为可注册的工作区技能。",
        },
        "lime",
      );
      expect(mocks.listRegisteredSkills).toHaveBeenCalledTimes(2);
      expect(mocks.listWorkspaceSkillBindings).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("项目报告");
      expect(
        container.querySelector(
          '[data-testid="workspace-registered-skill-enable-runtime"]',
        ),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("用户安装页没有当前项目时不读取 workspace skill binding readiness", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPage({ initialView: "installed" });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        container.querySelector(
          '[data-testid="workspace-registered-skills-panel"]',
        ),
      ).toBeNull();
      expect(container.textContent).not.toContain("当前项目还没有已保存技能");
      expect(mocks.getProject).not.toHaveBeenCalled();
      expect(mocks.listRegisteredSkills).not.toHaveBeenCalled();
      expect(mocks.listWorkspaceSkillBindings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("用户安装页有当前项目时按 current project 读取 workspace skill binding readiness", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPage({
        initialView: "installed",
        creationProjectId: "default-workspace",
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        container.querySelector(
          '[data-testid="workspace-registered-skills-panel"]',
        ),
      ).toBeNull();
      expect(container.textContent).not.toContain("当前项目还没有已保存技能");
      expect(mocks.getProject).toHaveBeenCalledWith("default-workspace");
      expect(mocks.listRegisteredSkills).toHaveBeenCalledWith({
        workspaceRoot: "/Users/demo/Lime/default-workspace",
      });
      expect(mocks.listWorkspaceSkillBindings).toHaveBeenCalledWith({
        workspaceRoot: "/Users/demo/Lime/default-workspace",
        caller: "assistant",
        workbench: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("用户安装页有已保存技能时显示已保存技能面板", async () => {
    const savedSkill: WorkspaceRegisteredSkillRecord = {
      key: "workspace:writer-agent",
      name: "项目写作技能",
      description: "保存到当前项目的写作技能。",
      directory: "writer-agent",
      registeredSkillDirectory:
        "/Users/demo/Lime/default-workspace/.agents/skills/writer-agent",
      registration: {
        registrationId: "capreg-writer-agent",
        registeredAt: "2026-06-01T08:00:00.000Z",
        skillDirectory: "writer-agent",
        registeredSkillDirectory:
          "/Users/demo/Lime/default-workspace/.agents/skills/writer-agent",
        sourceDraftId: "capdraft-writer-agent",
        sourceVerificationReportId: null,
        generatedFileCount: 1,
        permissionSummary: [],
        verificationGates: [],
        approvalRequests: [],
      },
      permissionSummary: [],
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
      runtimeGate: "等待手动启用",
    };
    vi.useFakeTimers();
    mocks.listRegisteredSkills.mockResolvedValueOnce([savedSkill]);
    try {
      const { container } = renderPage({
        initialView: "installed",
        creationProjectId: "default-workspace",
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        container.querySelector(
          '[data-testid="workspace-registered-skills-panel"]',
        ),
      ).toBeTruthy();
      expect(container.textContent).toContain("已保存技能");
      expect(container.textContent).toContain("项目写作技能");
    } finally {
      vi.useRealTimers();
    }
  });

  it("已保存技能点击试用一次应跳到 Agent 并携带 workspace runtime enable metadata", async () => {
    const savedSkill: WorkspaceRegisteredSkillRecord = {
      key: "workspace:capability-report",
      name: "只读 CLI 报告",
      description: "把本地只读 CLI 输出整理成 Markdown 报告。",
      directory: "capability-report",
      registeredSkillDirectory:
        "/Users/demo/Lime/default-workspace/.agents/skills/capability-report",
      registration: {
        registrationId: "capreg-capability-report",
        registeredAt: "2026-06-01T08:00:00.000Z",
        skillDirectory: "capability-report",
        registeredSkillDirectory:
          "/Users/demo/Lime/default-workspace/.agents/skills/capability-report",
        sourceDraftId: "capdraft-capability-report",
        sourceVerificationReportId: "capver-capability-report",
        generatedFileCount: 1,
        permissionSummary: ["Level 0 只读发现"],
        verificationGates: [],
        approvalRequests: [],
      },
      permissionSummary: ["Level 0 只读发现"],
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
      runtimeGate: "等待手动启用",
    };
    vi.useFakeTimers();
    mocks.listRegisteredSkills.mockResolvedValueOnce([savedSkill]);
    mocks.listWorkspaceSkillBindings.mockResolvedValueOnce({
      request: {
        workspace_root: "/Users/demo/Lime/default-workspace",
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: false,
        },
      },
      warnings: [],
      counts: {
        registered_total: 1,
        ready_for_manual_enable_total: 1,
        blocked_total: 0,
        query_loop_visible_total: 0,
        tool_runtime_visible_total: 0,
        launch_enabled_total: 0,
      },
      bindings: [
        {
          key: "workspace_skill:capability-report",
          name: "只读 CLI 报告",
          description: "把本地只读 CLI 输出整理成 Markdown 报告。",
          directory: "capability-report",
          registered_skill_directory:
            "/Users/demo/Lime/default-workspace/.agents/skills/capability-report",
          registration: {
            registration_id: "capreg-capability-report",
            registered_at: "2026-06-01T08:00:00.000Z",
            skill_directory: "capability-report",
            registered_skill_directory:
              "/Users/demo/Lime/default-workspace/.agents/skills/capability-report",
            source_draft_id: "capdraft-capability-report",
            source_verification_report_id: "capver-capability-report",
            generated_file_count: 1,
            permission_summary: ["Level 0 只读发现"],
          },
          permission_summary: ["Level 0 只读发现"],
          metadata: {},
          allowed_tools: [],
          resource_summary: {
            has_scripts: true,
            has_references: false,
            has_assets: false,
          },
          standard_compliance: {
            is_standard: true,
            validation_errors: [],
            deprecated_fields: [],
          },
          runtime_binding_target: "workspace_skill",
          binding_status: "ready_for_manual_enable",
          binding_status_reason: "已具备 runtime binding 候选资格。",
          next_gate: "manual_runtime_enable",
          query_loop_visible: false,
          tool_runtime_visible: false,
          launch_enabled: false,
          runtime_gate: "等待 P3E 显式启用。",
        },
      ],
    });
    try {
      const { container, onNavigate } = renderPage({
        initialView: "installed",
        creationProjectId: "default-workspace",
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const enableButton = container.querySelector(
        '[data-testid="workspace-registered-skill-enable-runtime"]',
      ) as HTMLButtonElement | null;
      expect(enableButton).toBeTruthy();
      expect(enableButton?.disabled).toBe(false);

      await act(async () => {
        enableButton?.click();
        await Promise.resolve();
      });

      expect(onNavigate).toHaveBeenCalledWith(
        "agent",
        expect.objectContaining({
          agentEntry: "new-task",
          projectId: "default-workspace",
          autoRunInitialPromptOnMount: true,
          initialUserPrompt: expect.stringContaining("只读 CLI 报告"),
          initialRequestMetadata: {
            harness: {
              workspace_skill_runtime_enable: expect.objectContaining({
                source: "manual_session_enable",
                approval: "manual",
                workspace_root: "/Users/demo/Lime/default-workspace",
                bindings: [
                  expect.objectContaining({
                    directory: "capability-report",
                    skill: "project:capability-report",
                    registered_skill_directory:
                      "/Users/demo/Lime/default-workspace/.agents/skills/capability-report",
                    source_draft_id: "capdraft-capability-report",
                    source_verification_report_id: "capver-capability-report",
                  }),
                ],
              }),
            },
          },
          initialAutoSendRequestMetadata: {
            harness: {
              workspace_skill_runtime_enable: expect.objectContaining({
                source: "manual_session_enable",
                approval: "manual",
              }),
            },
          },
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("内置页点击详情应读取并展示对应 SKILL.md", async () => {
    const { container } = renderPage();

    act(() => {
      findButton(container, "内置")?.click();
    });

    const row = findLocalSkillRow(container, "aspnet-core");
    expect(row).toBeTruthy();

    await act(async () => {
      findButtonIn(row!, "详情")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.inspectLocalSkillDetail).toHaveBeenCalledWith(
      "aspnet-core",
      "lime",
    );
    expect(
      container.querySelector('[data-testid="skills-installed-detail"]'),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Detail for aspnet-core");
    expect(container.querySelector("strong")?.textContent).toBe("aspnet-core");
    expect(container.querySelector("code")?.textContent).toBe("SKILL.md");
    expect(container.querySelector("table")?.textContent).toContain("Ready");
  });

  it("用户安装页点击详情应读取并展示对应 SKILL.md", async () => {
    const { container } = renderPage();

    act(() => {
      findButton(container, "用户安装")?.click();
    });

    const row = findLocalSkillRow(container, "writer");
    expect(row).toBeTruthy();

    await act(async () => {
      findButtonIn(row!, "详情")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.inspectLocalSkillDetail).toHaveBeenCalledWith(
      "writer",
      "lime",
    );
    expect(
      container.querySelector('[data-testid="skills-installed-detail"]'),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Detail for writer");
    expect(container.querySelector("strong")?.textContent).toBe("writer");
    expect(container.querySelector("code")?.textContent).toBe("SKILL.md");
    expect(container.querySelector("table")?.textContent).toContain("Ready");
  });

  it("用户安装详情应展示完整文件树并支持点击文件预览", async () => {
    mocks.inspectLocalSkillDetail.mockImplementation((directory: string) =>
      Promise.resolve({
        directory,
        inspection: {
          content: "# Writer\n\nMain guide",
          metadata: {},
          allowedTools: [],
          resourceSummary: {
            hasScripts: false,
            hasReferences: true,
            hasAssets: false,
          },
          standardCompliance: {
            isStandard: true,
            validationErrors: [],
            deprecatedFields: [],
          },
        },
        files: [
          {
            path: "SKILL.md",
            isDirectory: false,
            size: 20,
            content: "# Writer\n\nMain guide",
          },
          { path: "engines", isDirectory: true, size: 0 },
          {
            path: "engines/e01-pitch-deck.md",
            isDirectory: false,
            size: 28,
            content: "# Pitch Deck\n\nSlide flow",
          },
          {
            path: "engines/e02-work-report.md",
            isDirectory: false,
            size: 30,
            content: "# Work Report\n\nStatus flow",
          },
          { path: "shared", isDirectory: true, size: 0 },
          {
            path: "shared/storytelling-framework.md",
            isDirectory: false,
            size: 42,
            content: "# Storytelling Framework\n\nNarrative hooks",
          },
        ],
      }),
    );

    const { container } = renderPage();

    act(() => {
      findButton(container, "用户安装")?.click();
    });

    const row = findLocalSkillRow(container, "writer");
    await act(async () => {
      findButtonIn(row!, "详情")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const detail = container.querySelector(
      '[data-testid="skills-installed-detail"]',
    ) as HTMLElement | null;
    expect(detail?.textContent).toContain("e01-pitch-deck.md");
    expect(detail?.textContent).toContain("e02-work-report.md");
    expect(detail?.textContent).toContain("storytelling-framework.md");

    await act(async () => {
      findButtonIn(detail!, "storytelling-framework.md")?.click();
      await Promise.resolve();
    });

    expect(detail?.textContent).toContain("Narrative hooks");
  });
});
