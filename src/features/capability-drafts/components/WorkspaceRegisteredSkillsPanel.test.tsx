import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityDraftsApi } from "@/lib/api/capabilityDrafts";
import {
  exportAgentRuntimeEvidencePack,
  listWorkspaceSkillBindings,
} from "@/lib/api/agentRuntime";
import {
  getAutomationJobs,
  getAutomationRunHistory,
  updateAutomationJob,
} from "@/lib/api/automation";
import { WorkspaceRegisteredSkillsPanel } from "./WorkspaceRegisteredSkillsPanel";

vi.mock("@/lib/api/capabilityDrafts", () => ({
  capabilityDraftsApi: {
    listRegisteredSkills: vi.fn(),
  },
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  exportAgentRuntimeEvidencePack: vi.fn(),
  listWorkspaceSkillBindings: vi.fn(),
}));

vi.mock("@/lib/api/automation", () => ({
  getAutomationJobs: vi.fn(),
  getAutomationRunHistory: vi.fn(),
  updateAutomationJob: vi.fn(),
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
    vi.mocked(listWorkspaceSkillBindings).mockReset();
    vi.mocked(getAutomationJobs).mockReset();
    vi.mocked(getAutomationJobs).mockResolvedValue([]);
    vi.mocked(getAutomationRunHistory).mockReset();
    vi.mocked(updateAutomationJob).mockReset();
    vi.mocked(exportAgentRuntimeEvidencePack).mockReset();
    vi.mocked(listWorkspaceSkillBindings).mockResolvedValue({
      request: {
        workspace_root: "/tmp/work",
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: false,
        },
      },
      warnings: [],
      counts: {
        registered_total: 0,
        ready_for_manual_enable_total: 0,
        blocked_total: 0,
        query_loop_visible_total: 0,
        tool_runtime_visible_total: 0,
        launch_enabled_total: 0,
      },
      bindings: [],
    });
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
    expect(listWorkspaceSkillBindings).not.toHaveBeenCalled();
    expect(getAutomationJobs).not.toHaveBeenCalled();
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
          "已注册为 Workspace 本地 Skill 包；进入运行前还需要 P3C runtime binding 与 tool_runtime 授权。",
      },
    ]);
    vi.mocked(listWorkspaceSkillBindings).mockResolvedValueOnce({
      request: {
        workspace_root: "/tmp/work",
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: false,
        },
      },
      warnings: [
        "P3C 当前只返回 runtime binding readiness；不会 reload Skill，也不会注入默认 tool surface。",
      ],
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
            "/tmp/work/.agents/skills/capability-report",
          registration: {
            registration_id: "capreg-1",
            registered_at: "2026-05-05T01:10:00.000Z",
            skill_directory: "capability-report",
            registered_skill_directory:
              "/tmp/work/.agents/skills/capability-report",
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
            generated_file_count: 4,
            permission_summary: ["Level 0 只读发现", "允许执行本地 CLI"],
          },
          permission_summary: ["Level 0 只读发现", "允许执行本地 CLI"],
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
          binding_status_reason:
            "已具备后续 workspace catalog binding 候选资格；当前仍未注入 Query Loop 或 tool_runtime。",
          next_gate: "manual_runtime_enable",
          query_loop_visible: false,
          tool_runtime_visible: false,
          launch_enabled: false,
          runtime_gate:
            "等待 P3C 后续把该 workspace skill 显式绑定到 Query Loop metadata 与 tool_runtime 授权裁剪。",
        },
      ],
    });

    const { container } = renderPanel({ workspaceRoot: "/tmp/work" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.listRegisteredSkills).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
    });
    expect(listWorkspaceSkillBindings).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
      caller: "assistant",
      workbench: true,
    });
    expect(container.textContent).toContain("只读 CLI 报告");
    expect(container.textContent).toContain("已注册");
    expect(container.textContent).toContain("P3C binding 候选");
    expect(container.textContent).toContain("capdraft-1 / capver-1");
    expect(container.textContent).toContain(
      "Level 0 只读发现 / 允许执行本地 CLI",
    );
    expect(container.textContent).toContain("scripts");
    expect(container.textContent).toContain("Agent Skills 标准通过");
    expect(container.textContent).toContain(
      "当前仍未注入 Query Loop 或 tool_runtime",
    );
    expect(container.textContent).toContain("manual_runtime_enable");
    expect(container.textContent).toContain("Agent envelope 草案");
    expect(container.textContent).toContain("等待成功运行");
    expect(container.textContent).toContain(
      "成功运行后可把 Skill、权限、手动 rerun 和 evidence 组合成 Workspace Agent envelope。",
    );
    expect(container.textContent).toContain(
      "Evidence：还没有成功运行证据；先通过本回合启用拿到一次结果。",
    );
    expect(container.textContent).toContain("Managed Job：未创建");
    expect(container.textContent).not.toContain("立即运行");
    expect(container.textContent).not.toContain("创建自动化");
    expect(container.textContent).not.toContain("继续这套方法");
  });

  it("显式传入 runtime enable handler 时，仅 ready binding 可触发本回合启用", async () => {
    const onEnableRuntime = vi.fn();
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
          permissionSummary: ["Level 0 只读发现"],
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
        runtimeGate: "等待 runtime gate。",
      },
    ]);
    vi.mocked(listWorkspaceSkillBindings).mockResolvedValueOnce({
      request: {
        workspace_root: "/tmp/work",
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
            "/tmp/work/.agents/skills/capability-report",
          registration: {
            registration_id: "capreg-1",
            registered_at: "2026-05-05T01:10:00.000Z",
            skill_directory: "capability-report",
            registered_skill_directory:
              "/tmp/work/.agents/skills/capability-report",
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
            generated_file_count: 4,
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
          binding_status_reason: "已具备后续 runtime binding 候选资格。",
          next_gate: "manual_runtime_enable",
          query_loop_visible: false,
          tool_runtime_visible: false,
          launch_enabled: false,
          runtime_gate: "等待 P3E 显式启用。",
        },
      ],
    });

    const { container } = renderPanel({
      workspaceRoot: "/tmp/work",
      onEnableRuntime,
    });

    await act(async () => {
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

    expect(onEnableRuntime).toHaveBeenCalledTimes(1);
    expect(onEnableRuntime.mock.calls[0]?.[0]).toMatchObject({
      directory: "capability-report",
      binding_status: "ready_for_manual_enable",
    });
  });

  it("显式传入 managed automation handler 时，ready binding 可打开 Managed Job 草案", async () => {
    const onCreateManagedAutomationDraft = vi.fn();
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
          permissionSummary: ["Level 0 只读发现"],
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
        runtimeGate: "等待 runtime gate。",
      },
    ]);
    vi.mocked(listWorkspaceSkillBindings).mockResolvedValueOnce({
      request: {
        workspace_root: "/tmp/work",
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
            "/tmp/work/.agents/skills/capability-report",
          registration: {
            registration_id: "capreg-1",
            registered_at: "2026-05-05T01:10:00.000Z",
            skill_directory: "capability-report",
            registered_skill_directory:
              "/tmp/work/.agents/skills/capability-report",
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
            generated_file_count: 4,
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
          binding_status_reason: "已具备后续 runtime binding 候选资格。",
          next_gate: "manual_runtime_enable",
          query_loop_visible: false,
          tool_runtime_visible: false,
          launch_enabled: false,
          runtime_gate: "等待 P3E 显式启用。",
        },
      ],
    });
    const managedJob = {
      id: "job-1",
      name: "只读 CLI 报告｜Managed Agent 草案",
      description: null,
      enabled: false,
      workspace_id: "project-1",
      execution_mode: "skill",
      schedule: {
        kind: "cron",
        expr: "0 9 * * *",
        tz: "Asia/Shanghai",
      },
      payload: {
        kind: "agent_turn",
        prompt: "run",
        web_search: false,
        request_metadata: {
          harness: {
            agent_envelope: {
              directory: "capability-report",
              skill: "project:capability-report",
            },
          },
        },
      },
      delivery: {
        mode: "none",
        best_effort: true,
      },
      timeout_secs: null,
      max_retries: 2,
      next_run_at: null,
      last_status: null,
      last_error: null,
      last_run_at: null,
      last_finished_at: null,
      running_started_at: null,
      consecutive_failures: 0,
      last_retry_count: 0,
      auto_disabled_until: null,
      created_at: "2026-05-06T10:00:00Z",
      updated_at: "2026-05-06T10:00:00Z",
    };
    vi.mocked(getAutomationJobs).mockResolvedValueOnce([managedJob as any]);
    vi.mocked(updateAutomationJob).mockResolvedValueOnce({
      ...managedJob,
      enabled: true,
      last_status: "success",
    } as any);
    vi.mocked(getAutomationRunHistory).mockResolvedValueOnce([
      {
        id: "run-1",
        source: "automation",
        source_ref: "job-1",
        session_id: "session-1",
        status: "success",
        started_at: "2026-05-06T10:00:00Z",
        finished_at: "2026-05-06T10:01:00Z",
        duration_ms: 60_000,
        error_code: null,
        error_message: null,
        metadata: null,
        created_at: "2026-05-06T10:00:00Z",
        updated_at: "2026-05-06T10:01:00Z",
      },
    ]);
    vi.mocked(exportAgentRuntimeEvidencePack).mockResolvedValueOnce({
      session_id: "session-1",
      thread_id: "thread-1",
      workspace_root: "/tmp/work",
      pack_relative_root: ".lime/harness/sessions/session-1/evidence",
      pack_absolute_root: "/tmp/work/.lime/harness/sessions/session-1/evidence",
      exported_at: "2026-05-06T10:02:00Z",
      thread_status: "completed",
      turn_count: 1,
      item_count: 3,
      pending_request_count: 0,
      queued_turn_count: 0,
      recent_artifact_count: 1,
      known_gaps: [],
      completion_audit_summary: {
        source: "runtime_evidence_pack_completion_audit",
        decision: "completed",
        owner_run_count: 1,
        successful_owner_run_count: 1,
        workspace_skill_tool_call_count: 1,
        artifact_count: 1,
        owner_audit_statuses: ["audit_input_ready"],
        required_evidence: {
          automation_owner: true,
          workspace_skill_tool_call: true,
          artifact_or_timeline: true,
        },
        blocking_reasons: [],
        notes: [],
      },
      artifacts: [],
    } as any);

    const { container } = renderPanel({
      workspaceRoot: "/tmp/work",
      workspaceId: "project-1",
      onCreateManagedAutomationDraft,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const managedButton = container.querySelector(
      '[data-testid="workspace-registered-agent-managed-automation"]',
    ) as HTMLButtonElement | null;
    const toggleButton = container.querySelector(
      '[data-testid="workspace-registered-agent-managed-automation-toggle"]',
    ) as HTMLButtonElement | null;
    const auditButton = container.querySelector(
      '[data-testid="workspace-registered-agent-completion-audit"]',
    ) as HTMLButtonElement | null;
    expect(managedButton).toBeTruthy();
    expect(managedButton?.disabled).toBe(false);
    expect(container.textContent).toContain("Agent card：等待 evidence-ready");
    expect(container.textContent).toContain("Sharing：未完成审计前");
    expect(container.textContent).toContain("Discovery：同 workspace 成员");
    expect(container.textContent).toContain("Memory：引用 verification report");
    expect(container.textContent).toContain("Widget：等待运行后展示状态");
    expect(container.textContent).toContain("Managed Job：草案暂停");
    expect(container.textContent).toContain("Schedule：Cron 0 9 * * *");
    expect(container.textContent).toContain("Managed Objective：paused");
    expect(container.textContent).toContain("Completion Audit：paused");
    expect(toggleButton).toBeTruthy();
    expect(toggleButton?.textContent).toContain("恢复 Managed Job");
    expect(auditButton).toBeTruthy();

    await act(async () => {
      managedButton?.click();
      await Promise.resolve();
    });

    expect(onCreateManagedAutomationDraft).toHaveBeenCalledTimes(1);
    expect(onCreateManagedAutomationDraft.mock.calls[0]?.[0]).toMatchObject({
      directory: "capability-report",
      binding_status: "ready_for_manual_enable",
      registration: {
        source_draft_id: "capdraft-1",
        source_verification_report_id: "capver-1",
      },
    });

    await act(async () => {
      toggleButton?.click();
      await Promise.resolve();
    });

    expect(updateAutomationJob).toHaveBeenCalledWith("job-1", {
      enabled: true,
    });
    expect(container.textContent).toContain("Managed Job：已启用");

    await act(async () => {
      auditButton?.click();
      await Promise.resolve();
    });

    expect(getAutomationRunHistory).toHaveBeenCalledWith("job-1", 5);
    expect(exportAgentRuntimeEvidencePack).toHaveBeenCalledWith("session-1");
    expect(container.textContent).toContain("completion audit completed");
    expect(container.textContent).toContain(
      "Agent card：workspace-local/capability-report",
    );
    expect(container.textContent).toContain("workspace / team 内共享");
    expect(container.textContent).toContain("复用同一 Managed Job / evidence");

    const envelopeButton = container.querySelector(
      '[data-testid="workspace-registered-agent-envelope-action"]',
    ) as HTMLButtonElement | null;
    expect(envelopeButton?.disabled).toBe(false);

    await act(async () => {
      envelopeButton?.click();
      await Promise.resolve();
    });

    expect(onCreateManagedAutomationDraft).toHaveBeenCalledTimes(2);
  });

  it("completion audit completed 时 Agent envelope 入口复用 Managed Job 草案创建链", async () => {
    const onCreateManagedAutomationDraft = vi.fn();
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
          permissionSummary: ["Level 0 只读发现"],
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
        runtimeGate: "等待 runtime gate。",
      },
    ]);
    vi.mocked(listWorkspaceSkillBindings).mockResolvedValueOnce({
      request: {
        workspace_root: "/tmp/work",
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
            "/tmp/work/.agents/skills/capability-report",
          registration: {
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
            registered_skill_directory:
              "/tmp/work/.agents/skills/capability-report",
          },
          permission_summary: ["Level 0 只读发现"],
          metadata: {},
          allowed_tools: [],
          resource_summary: {
            has_scripts: true,
          },
          standard_compliance: {
            is_standard: true,
          },
          runtime_binding_target: "workspace_skill",
          binding_status: "ready_for_manual_enable",
          binding_status_reason: "已具备后续 runtime binding 候选资格。",
          next_gate: "manual_runtime_enable",
          query_loop_visible: false,
          tool_runtime_visible: false,
          launch_enabled: false,
          runtime_gate: "等待 P3E 显式启用。",
        },
      ],
    } as any);

    const { container } = renderPanel({
      workspaceRoot: "/tmp/work",
      workspaceId: "project-1",
      onCreateManagedAutomationDraft,
      completionAuditSummariesByDirectory: {
        "capability-report": {
          source: "runtime_evidence_pack_completion_audit",
          decision: "completed",
          owner_run_count: 1,
          successful_owner_run_count: 1,
          workspace_skill_tool_call_count: 1,
          artifact_count: 2,
          owner_audit_statuses: ["audit_input_ready"],
          required_evidence: {
            automation_owner: true,
            workspace_skill_tool_call: true,
            artifact_or_timeline: true,
          },
          blocking_reasons: [],
          notes: [],
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const envelopeButton = container.querySelector(
      '[data-testid="workspace-registered-agent-envelope-action"]',
    ) as HTMLButtonElement | null;
    expect(envelopeButton).toBeTruthy();
    expect(envelopeButton?.disabled).toBe(false);
    expect(container.textContent).toContain("completion audit completed");

    await act(async () => {
      envelopeButton?.click();
      await Promise.resolve();
    });

    expect(onCreateManagedAutomationDraft).toHaveBeenCalledTimes(1);
    expect(onCreateManagedAutomationDraft.mock.calls[0]?.[0]).toMatchObject({
      directory: "capability-report",
      binding_status: "ready_for_manual_enable",
    });
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
            registeredSkillDirectory: "/tmp/work/.agents/skills/capability-new",
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
    vi.mocked(listWorkspaceSkillBindings)
      .mockResolvedValueOnce({
        request: {
          workspace_root: "/tmp/work",
          caller: "assistant",
          surface: {
            workbench: true,
            browser_assist: false,
          },
        },
        warnings: [],
        counts: {
          registered_total: 0,
          ready_for_manual_enable_total: 0,
          blocked_total: 0,
          query_loop_visible_total: 0,
          tool_runtime_visible_total: 0,
          launch_enabled_total: 0,
        },
        bindings: [],
      })
      .mockResolvedValueOnce({
        request: {
          workspace_root: "/tmp/work",
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
            key: "workspace_skill:capability-new",
            name: "新注册能力",
            description: "刷新后出现。",
            directory: "capability-new",
            registered_skill_directory:
              "/tmp/work/.agents/skills/capability-new",
            registration: {
              registration_id: "capreg-2",
              registered_at: "2026-05-05T01:20:00.000Z",
              skill_directory: "capability-new",
              registered_skill_directory:
                "/tmp/work/.agents/skills/capability-new",
              source_draft_id: "capdraft-2",
              source_verification_report_id: "capver-2",
              generated_file_count: 3,
              permission_summary: ["Level 0 只读发现"],
            },
            permission_summary: ["Level 0 只读发现"],
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
            binding_status_reason: "已具备后续 runtime binding 候选资格。",
            next_gate: "manual_runtime_enable",
            query_loop_visible: false,
            tool_runtime_visible: false,
            launch_enabled: false,
            runtime_gate: "等待 P3C 后续绑定。",
          },
        ],
      });

    const { container, root } = renderPanel({
      workspaceRoot: "/tmp/work",
      refreshSignal: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "当前项目还没有通过 P3A 注册的能力",
    );

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
    expect(listWorkspaceSkillBindings).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("新注册能力");
  });
});
