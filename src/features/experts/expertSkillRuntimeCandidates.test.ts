import { describe, expect, it } from "vitest";
import type { SkillCatalog } from "@/lib/api/skillCatalog";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import type { Skill } from "@/lib/api/skills";
import { buildExpertSkillRuntimeCandidates } from "./expertSkillRuntimeCandidates";

const TEST_CATALOG: SkillCatalog = {
  version: "test",
  catalogId: "local",
  syncedAt: "2026-06-21T00:00:00.000Z",
  items: [],
  entries: [
    {
      id: "skill:code-review",
      kind: "skill",
      title: "代码审查",
      summary: "审查代码风险和可维护性。",
      skillId: "code-review",
      groupKey: "engineering",
      execution: {
        kind: "agent_turn",
      },
      skillLocator: {
        source: "catalog",
        name: "code-review",
      },
    },
  ],
  groups: [],
};

const LOCAL_SKILL: Skill = {
  key: "docx",
  name: "docx",
  description: "读取 Word 文档。",
  directory: "docx",
  installed: true,
  sourceKind: "builtin",
  catalogSource: "user",
};

function serviceSkill(
  input: Pick<
    ServiceSkillItem,
    "id" | "title" | "summary" | "defaultExecutorBinding"
  > &
    Partial<ServiceSkillItem>,
): ServiceSkillItem {
  return {
    skillKey: input.id,
    category: "内容运营",
    outputHint: "输出",
    source: "cloud_catalog",
    runnerType: "instant",
    executionLocation: "client_default",
    slotSchema: [],
    version: "test",
    ...input,
  };
}

function workspaceSkillBinding(
  overrides: Partial<AgentRuntimeWorkspaceSkillBinding> = {},
): AgentRuntimeWorkspaceSkillBinding {
  return {
    key: "workspace_skill:capability-report",
    name: "能力报告",
    description: "把能力输出整理成报告。",
    directory: "capability-report",
    registered_skill_directory:
      "/Users/demo/project/.agents/skills/capability-report",
    registration: {},
    permission_summary: ["Level 0 只读发现"],
    metadata: {},
    allowed_tools: ["read_file"],
    resource_summary: {},
    standard_compliance: {},
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

describe("buildExpertSkillRuntimeCandidates", () => {
  it("把专家 skill:* ref 解析成带 skillLocator 的 catalog candidate", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["skill:code-review"],
      { catalog: TEST_CATALOG },
    );

    expect(candidate).toMatchObject({
      ref: "skill:code-review",
      kind: "catalog_skill",
      readiness: "ready",
      displayTitle: "代码审查",
      source: "expert_skill_ref",
      riskLevel: "low",
      skillLocator: {
        source: "catalog",
        name: "code-review",
      },
    });
    expect(candidate?.reason).toContain("SkillCatalog");
  });

  it("保留 service-skill ref 为需映射候选，不直接授权执行", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates([
      "service-skill:daily-trend-briefing",
    ]);

    expect(candidate).toMatchObject({
      ref: "service-skill:daily-trend-briefing",
      kind: "service_skill",
      readiness: "needs_mapping",
      riskLevel: "medium",
      skillLocator: {
        source: "catalog",
        name: "daily-trend-briefing",
      },
    });
    expect(candidate?.reason).toContain("service_scene_launch");
  });

  it("把 native service-skill ref 精确映射到 SkillCatalog locator", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["service-skill:code-review-service"],
      {
        catalog: TEST_CATALOG,
        serviceSkills: [
          serviceSkill({
            id: "code-review-service",
            skillKey: "code-review",
            title: "代码审查服务",
            summary: "审查代码风险。",
            defaultExecutorBinding: "native_skill",
          }),
        ],
      },
    );

    expect(candidate).toMatchObject({
      ref: "service-skill:code-review-service",
      kind: "service_skill",
      readiness: "ready",
      displayTitle: "代码审查",
      riskLevel: "low",
      skillLocator: {
        source: "catalog",
        name: "code-review",
      },
    });
    expect(candidate?.reason).toContain("native SkillCatalog");
  });

  it("非 native service-skill ref 仍需 service_scene_launch 映射", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["service-skill:daily-trend-briefing"],
      {
        serviceSkills: [
          serviceSkill({
            id: "daily-trend-briefing",
            title: "每日趋势摘要",
            summary: "产出趋势摘要和调度建议。",
            defaultExecutorBinding: "automation_job",
          }),
        ],
      },
    );

    expect(candidate).toMatchObject({
      ref: "service-skill:daily-trend-briefing",
      kind: "service_skill",
      readiness: "needs_mapping",
      displayTitle: "每日趋势摘要",
      riskLevel: "medium",
      skillLocator: {
        source: "catalog",
        name: "daily-trend-briefing",
      },
    });
    expect(candidate?.reason).toContain("service_scene_launch");
  });

  it("native service-skill 缺少目录或本地 locator 时不冒充 ready", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["service-skill:unmapped-native"],
      {
        serviceSkills: [
          serviceSkill({
            id: "unmapped-native",
            skillKey: "missing-native",
            title: "未映射 Native Skill",
            summary: "目录尚未安装。",
            defaultExecutorBinding: "native_skill",
          }),
        ],
      },
    );

    expect(candidate).toMatchObject({
      ref: "service-skill:unmapped-native",
      kind: "service_skill",
      readiness: "needs_mapping",
      displayTitle: "未映射 Native Skill",
      riskLevel: "medium",
      skillLocator: {
        source: "catalog",
        name: "missing-native",
      },
    });
    expect(candidate?.reason).toContain(
      "no SkillCatalog or local Skill locator",
    );
  });

  it("把已安装本地 skill:* ref 解析成可运行候选", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(["skill:docx"], {
      localSkills: [LOCAL_SKILL],
    });

    expect(candidate).toMatchObject({
      ref: "skill:docx",
      kind: "catalog_skill",
      readiness: "ready",
      displayTitle: "docx",
      riskLevel: "low",
      skillLocator: {
        source: "user",
        name: "docx",
        directory: "docx",
      },
    });
    expect(candidate?.reason).toContain("local Skill");
  });

  it("把 workspace_skill ref 标为需要 ready binding", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates([
      "workspace_skill:capability-report",
    ]);

    expect(candidate).toMatchObject({
      ref: "workspace_skill:capability-report",
      kind: "workspace_skill",
      readiness: "needs_registration",
      skillLocator: {
        source: "project",
        name: "project:capability-report",
        directory: "capability-report",
      },
    });
    expect(candidate?.reason).toContain("workspaceSkillBindings/list");
  });

  it("把已注册 workspace_skill ref 标为待手动启用", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["workspace_skill:capability-report@1.0.0"],
      {
        workspaceSkillBindings: [workspaceSkillBinding()],
      },
    );

    expect(candidate).toMatchObject({
      ref: "workspace_skill:capability-report@1.0.0",
      kind: "workspace_skill",
      readiness: "needs_enable",
      displayTitle: "能力报告",
      skillLocator: {
        source: "project",
        name: "project:capability-report",
        directory: "capability-report",
        skillFilePath: "/Users/demo/project/.agents/skills/capability-report",
      },
    });
    expect(candidate?.reason).toContain("ready_for_manual_enable");
  });

  it("把 blocked workspace_skill binding 标为不可用", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(
      ["workspace_skill:capability-report"],
      {
        workspaceSkillBindings: [
          workspaceSkillBinding({
            binding_status: "blocked",
            binding_status_reason: "SKILL.md 缺少 when_to_use",
          }),
        ],
      },
    );

    expect(candidate).toMatchObject({
      ref: "workspace_skill:capability-report",
      kind: "workspace_skill",
      readiness: "blocked",
      reason: "SKILL.md 缺少 when_to_use",
    });
  });

  it("支持 skill URI，并去重大小写等价 ref", () => {
    const candidates = buildExpertSkillRuntimeCandidates([
      "skill://project/capability-report/SKILL.md",
      "skill://project/capability-report/SKILL.md",
      "SKILL:CODE-REVIEW",
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      kind: "skill_uri",
      readiness: "ready",
      skillLocator: {
        source: "other",
        name: "capability-report",
        directory: "capability-report",
        skillFilePath: "skill://project/capability-report/SKILL.md",
      },
    });
    expect(candidates[1]).toMatchObject({
      kind: "unknown",
      readiness: "blocked",
    });
  });

  it("未知 ref fail-closed 为 blocked", () => {
    const [candidate] = buildExpertSkillRuntimeCandidates(["docx"]);

    expect(candidate).toMatchObject({
      ref: "docx",
      kind: "unknown",
      readiness: "blocked",
      reason: "unsupported expert skill ref format",
    });
  });
});
