import { describe, expect, it } from "vitest";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";
import {
  buildWorkspaceSkillManagedAutomationPresentation,
  buildWorkspaceSkillAgentAutomationInitialValues,
  buildWorkspaceSkillAgentAutomationRequestMetadata,
  canBuildWorkspaceSkillAgentAutomationDraft,
  isWorkspaceSkillAgentAutomationJobForDirectory,
} from "./workspaceSkillAgentAutomationDraft";

function createBinding(
  overrides: Partial<AgentRuntimeWorkspaceSkillBinding> = {},
): AgentRuntimeWorkspaceSkillBinding {
  return {
    key: "workspace_skill:capability-report",
    name: "只读 CLI 报告",
    description: "把本地只读 CLI 输出整理成 Markdown 报告。",
    directory: "capability-report",
    registered_skill_directory: "/tmp/work/.agents/skills/capability-report",
    registration: {
      sourceDraftId: "capdraft-1",
      sourceVerificationReportId: "capver-1",
      registeredSkillDirectory: "/tmp/work/.agents/skills/capability-report",
    },
    permission_summary: ["Level 0 只读发现"],
    metadata: {},
    allowed_tools: [],
    resource_summary: {
      hasScripts: true,
    },
    standard_compliance: {
      isStandard: true,
    },
    runtime_binding_target: "workspace_skill",
    binding_status: "ready_for_manual_enable",
    binding_status_reason: "ready",
    next_gate: "manual_runtime_enable",
    query_loop_visible: false,
    tool_runtime_visible: false,
    launch_enabled: false,
    runtime_gate: "manual_runtime_enable",
    ...overrides,
  };
}

describe("workspaceSkillAgentAutomationDraft", () => {
  it("应为 ready binding 构建 automation job 初始值，并把执行绑定到 P3E runtime enable", () => {
    const initialValues = buildWorkspaceSkillAgentAutomationInitialValues({
      binding: createBinding(),
      workspaceRoot: "/tmp/work",
      workspaceId: "project-1",
    });

    expect(initialValues).toMatchObject({
      name: "只读 CLI 报告｜Managed Agent 草案",
      workspace_id: "project-1",
      enabled: false,
      execution_mode: "skill",
      payload_kind: "agent_turn",
      schedule_kind: "cron",
      max_retries: "2",
    });
    expect(initialValues?.prompt).toContain("project:capability-report");
    expect(initialValues?.agent_request_metadata).toMatchObject({
      harness: {
        agent_envelope: {
          source: "creaoai_p4_agent_envelope",
          state: "automation_draft",
          skill: "project:capability-report",
          source_draft_id: "capdraft-1",
          source_verification_report_id: "capver-1",
          authorization_scope: "scheduled_run_session",
        },
        managed_objective: {
          source: "creaoai_p4_managed_execution",
          owner_type: "automation_job",
          state: "planned",
          completion_audit: "artifact_or_evidence_required",
        },
        workspace_skill_runtime_enable: {
          source: "agent_envelope_scheduled_run",
          approval: "manual",
          workspace_root: "/tmp/work",
          bindings: [
            {
              directory: "capability-report",
              skill: "project:capability-report",
              source_draft_id: "capdraft-1",
              source_verification_report_id: "capver-1",
            },
          ],
        },
      },
    });
  });

  it("blocked 或缺少 verification provenance 时不能构建 managed job 草案", () => {
    expect(
      canBuildWorkspaceSkillAgentAutomationDraft(
        createBinding({ binding_status: "blocked" }),
      ),
    ).toBe(false);
    expect(
      buildWorkspaceSkillAgentAutomationRequestMetadata({
        binding: createBinding({
          registration: {
            sourceDraftId: "capdraft-1",
            sourceVerificationReportId: null,
            registeredSkillDirectory:
              "/tmp/work/.agents/skills/capability-report",
          },
        }),
        workspaceRoot: "/tmp/work",
      }),
    ).toBeNull();
  });

  it("应识别 workspace skill 对应的 Managed Job 并生成状态摘要", () => {
    const job = {
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
    } as const;

    expect(
      isWorkspaceSkillAgentAutomationJobForDirectory(job, "capability-report"),
    ).toBe(true);
    expect(
      isWorkspaceSkillAgentAutomationJobForDirectory(job, "other-skill"),
    ).toBe(false);

    const presentation = buildWorkspaceSkillManagedAutomationPresentation([
      job,
    ]);
    expect(presentation.statusLabel).toContain("草案暂停");
    expect(presentation.objectiveLabel).toContain("paused");
    expect(presentation.auditLabel).toContain("paused");
    expect(presentation.scheduleLabel).toContain("Cron 0 9 * * *");
    expect(presentation.lastRunLabel).toContain("暂无");
  });

  it("成功运行后的 Managed Objective 只能进入 verifying，不能直接完成", () => {
    const presentation = buildWorkspaceSkillManagedAutomationPresentation([
      {
        id: "job-1",
        name: "只读 CLI 报告｜Managed Agent 草案",
        description: null,
        enabled: true,
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
        last_status: "success",
        last_error: null,
        last_run_at: "2026-05-06T10:00:00Z",
        last_finished_at: "2026-05-06T10:01:00Z",
        running_started_at: null,
        consecutive_failures: 0,
        last_retry_count: 0,
        auto_disabled_until: null,
        created_at: "2026-05-06T10:00:00Z",
        updated_at: "2026-05-06T10:01:00Z",
      } as const,
    ]);

    expect(presentation.objectiveLabel).toContain("verifying");
    expect(presentation.auditLabel).toContain("暂不直接标记 completed");
  });
});
