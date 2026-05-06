import { describe, expect, it } from "vitest";
import { buildAgentEnvelopeDraftPresentation } from "./agentEnvelopeDraftPresentation";
import type { WorkspaceRegisteredSkillRecord } from "@/lib/api/capabilityDrafts";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";

function createSkill(): WorkspaceRegisteredSkillRecord {
  return {
    key: "workspace:capability-report",
    name: "只读 CLI 报告",
    description: "把本地只读 CLI 输出整理成 Markdown 报告。",
    directory: "capability-report",
    registeredSkillDirectory: "/tmp/work/.agents/skills/capability-report",
    registration: {
      registrationId: "capreg-1",
      registeredAt: "2026-05-06T00:00:00.000Z",
      skillDirectory: "capability-report",
      registeredSkillDirectory: "/tmp/work/.agents/skills/capability-report",
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
    runtimeGate: "manual_runtime_enable",
  };
}

function createBinding(
  overrides: Partial<AgentRuntimeWorkspaceSkillBinding> = {},
): AgentRuntimeWorkspaceSkillBinding {
  return {
    key: "workspace:capability-report",
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
    runtime_binding_target: "native_skill",
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

describe("buildAgentEnvelopeDraftPresentation", () => {
  it("ready binding 只能提示先成功运行，不能直接启用 Agent 草案动作", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding(),
    });

    expect(presentation.stage).toBe("manual_enable_required");
    expect(presentation.evidenceStatus).toBe("missing");
    expect(presentation.actionLabel).toBe("先本回合启用");
    expect(presentation.actionEnabled).toBe(false);
    expect(presentation.evidenceLabel).toContain("还没有成功运行证据");
    expect(presentation.agentCardLabel).toContain("不创建平行持久化实体");
    expect(presentation.sharingLabel).toContain("未完成审计前");
    expect(presentation.sharingDiscoveryLabel).toContain(
      ".agents/skills/capability-report",
    );
    expect(presentation.memoryLabel).toContain("capver-1");
    expect(presentation.widgetLabel).toContain("等待运行后展示状态");
    expect(presentation.scheduleLabel).toContain("manual rerun 草案");
  });

  it("blocked binding 不应显示为可固化 Agent", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding({
        binding_status: "blocked",
        binding_status_reason: "缺少 verification provenance",
      }),
    });

    expect(presentation.stage).toBe("blocked");
    expect(presentation.statusLabel).toBe("Agent 草案阻塞");
    expect(presentation.actionLabel).toBe("先解除阻塞");
    expect(presentation.actionEnabled).toBe(false);
    expect(presentation.description).toContain("缺少 verification provenance");
  });

  it("P3E source metadata 应覆盖草案中的来源和权限摘要", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding(),
      sourceMetadata: {
        skillName: "project:capability-report",
        registeredSkillDirectory: "/tmp/work/.agents/skills/capability-report",
        sourceDraftId: "capdraft-runtime",
        sourceVerificationReportId: "capver-runtime",
        permissionSummary: ["Level 4 workspace-local verified execution"],
        authorizationScope: "session",
      },
    });

    expect(presentation.stage).toBe("source_metadata_ready");
    expect(presentation.evidenceStatus).toBe("source_metadata_only");
    expect(presentation.sourceDraftId).toBe("capdraft-runtime");
    expect(presentation.sourceVerificationReportId).toBe("capver-runtime");
    expect(presentation.runbookLabel).toContain("project:capability-report");
    expect(presentation.permissionLabel).toContain(
      "Level 4 workspace-local verified execution",
    );
  });

  it("只有 evidence pack id 但缺 completed audit 时不能进入 evidence-ready", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding(),
      evidencePackId: "evpack-1",
    });

    expect(presentation.stage).toBe("source_metadata_ready");
    expect(presentation.statusLabel).toBe("等待 Completion Audit");
    expect(presentation.evidenceStatus).toBe("source_metadata_only");
    expect(presentation.evidenceLabel).toContain("evpack-1");
    expect(presentation.evidenceLabel).toContain("缺 completed completion audit");
    expect(presentation.actionLabel).toBe("转成 Agent 草案");
    expect(presentation.actionEnabled).toBe(false);
  });

  it("completion audit completed 且证据齐全时应进入 evidence-ready 展示态", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding(),
      completionAuditSummary: {
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
    });

    expect(presentation.stage).toBe("evidence_ready");
    expect(presentation.evidenceStatus).toBe("evidence_pack_ready");
    expect(presentation.evidenceLabel).toContain("completion audit completed");
    expect(presentation.evidenceLabel).toContain("ToolCall 1");
    expect(presentation.agentCardLabel).toContain(
      "workspace-local/capability-report",
    );
    expect(presentation.sharingLabel).toContain("workspace / team 内共享");
    expect(presentation.sharingDiscoveryLabel).toContain("registered skill");
    expect(presentation.widgetLabel).toContain("审计结论");
    expect(presentation.actionLabel).toBe("转成 Agent 草案");
    expect(presentation.actionEnabled).toBe(true);
  });

  it("completion audit 未 completed 时不能误报为 evidence-ready", () => {
    const presentation = buildAgentEnvelopeDraftPresentation({
      skill: createSkill(),
      binding: createBinding(),
      completionAuditSummary: {
        source: "runtime_evidence_pack_completion_audit",
        decision: "verifying",
        owner_run_count: 1,
        successful_owner_run_count: 1,
        workspace_skill_tool_call_count: 0,
        artifact_count: 1,
        owner_audit_statuses: ["audit_input_ready"],
        required_evidence: {
          automation_owner: true,
          workspace_skill_tool_call: false,
          artifact_or_timeline: true,
        },
        blocking_reasons: ["missing_workspace_skill_tool_call_evidence"],
        notes: [],
      },
    });

    expect(presentation.stage).toBe("manual_enable_required");
    expect(presentation.evidenceStatus).toBe("missing");
    expect(presentation.actionEnabled).toBe(false);
  });
});
