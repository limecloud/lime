import { describe, expect, it } from "vitest";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";
import {
  buildWorkspaceSkillBindingsHarnessMetadata,
  buildWorkspaceSkillRuntimeEnableHarnessMetadata,
} from "./workspaceSkillBindingsMetadata";

function createBinding(
  overrides: Partial<AgentRuntimeWorkspaceSkillBinding> = {},
): AgentRuntimeWorkspaceSkillBinding {
  return {
    key: "capability-report",
    name: "只读 CLI 报告",
    description: "把只读 CLI 输出整理成 Markdown 报告。",
    directory: "capability-report",
    registered_skill_directory: "capability-report",
    registration: {
      source_draft_id: "capdraft-1",
      source_verification_report_id: "capver-1",
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
    runtime_binding_target: "workspace_local_skill",
    binding_status: "ready_for_manual_enable",
    binding_status_reason: "已通过注册检查，等待手动 runtime enable。",
    next_gate: "manual_runtime_enable",
    query_loop_visible: false,
    tool_runtime_visible: false,
    launch_enabled: false,
    runtime_gate: "manual_runtime_enable",
    ...overrides,
  };
}

describe("workspaceSkillBindingsMetadata", () => {
  it("空 binding 列表不输出 metadata", () => {
    expect(buildWorkspaceSkillBindingsHarnessMetadata([])).toBeUndefined();
    expect(buildWorkspaceSkillBindingsHarnessMetadata(null)).toBeUndefined();
  });

  it("应输出 P3D workspace_skill_bindings snake_case fragment", () => {
    const metadata = buildWorkspaceSkillBindingsHarnessMetadata([
      createBinding(),
    ]);

    expect(metadata).toEqual({
      workspace_skill_bindings: {
        source: "p3c_runtime_binding",
        bindings: [
          {
            directory: "capability-report",
            name: "只读 CLI 报告",
            description: "把只读 CLI 输出整理成 Markdown 报告。",
            binding_status: "ready_for_manual_enable",
            next_gate: "manual_runtime_enable",
            query_loop_visible: false,
            tool_runtime_visible: false,
            launch_enabled: false,
            permission_summary: ["Level 0 只读发现"],
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
          },
        ],
      },
    });
    expect(JSON.stringify(metadata)).not.toContain("allow_model_skills");
  });

  it("最多投影 5 个 binding，避免单回合 metadata 膨胀", () => {
    const metadata = buildWorkspaceSkillBindingsHarnessMetadata(
      Array.from({ length: 6 }, (_, index) =>
        createBinding({
          key: `skill-${index}`,
          directory: `skill-${index}`,
          name: `Skill ${index}`,
        }),
      ),
    );

    const bindings = metadata?.workspace_skill_bindings.bindings ?? [];
    expect(bindings).toHaveLength(5);
    expect(bindings.map((binding) => binding.directory)).toEqual([
      "skill-0",
      "skill-1",
      "skill-2",
      "skill-3",
      "skill-4",
    ]);
  });

  it("应裁剪长文本并保持 false 可见性字段", () => {
    const metadata = buildWorkspaceSkillBindingsHarnessMetadata([
      createBinding({
        description: `${"长描述".repeat(90)}\n带换行`,
      }),
    ]);

    const binding = metadata?.workspace_skill_bindings.bindings[0];
    expect(binding?.description).toMatch(/…$/);
    expect(binding?.description).not.toContain("\n");
    expect(binding?.query_loop_visible).toBe(false);
    expect(binding?.tool_runtime_visible).toBe(false);
    expect(binding?.launch_enabled).toBe(false);
  });

  it("应只为 ready binding 输出 P3E runtime enable metadata", () => {
    const metadata = buildWorkspaceSkillRuntimeEnableHarnessMetadata({
      workspaceRoot: "/tmp/work",
      bindings: [
        createBinding(),
        createBinding({
          key: "blocked",
          directory: "blocked",
          binding_status: "blocked",
        }),
      ],
    });

    expect(metadata).toEqual({
      workspace_skill_runtime_enable: {
        source: "manual_session_enable",
        approval: "manual",
        workspace_root: "/tmp/work",
        bindings: [
          {
            directory: "capability-report",
            skill: "project:capability-report",
            registered_skill_directory: "capability-report",
            source_draft_id: "capdraft-1",
            source_verification_report_id: "capver-1",
            permission_summary: ["Level 0 只读发现"],
          },
        ],
      },
    });
    expect(JSON.stringify(metadata)).not.toContain("allow_model_skills");
  });
});
