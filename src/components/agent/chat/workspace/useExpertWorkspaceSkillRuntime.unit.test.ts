import { describe, expect, it } from "vitest";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";
import {
  appendExpertWorkspaceSkillRuntimeEnableRef,
  filterExpertWorkspaceSkillRuntimeEnableRefsForSkillRefs,
  findWorkspaceSkillBindingByRef,
  resolveExpertWorkspaceSkillRuntimeEnableBindings,
  resolveExpertWorkspaceSkillRuntimeKey,
  workspaceSkillDirectoryFromRef,
} from "./useExpertWorkspaceSkillRuntime";

function createBinding(
  overrides: Partial<AgentRuntimeWorkspaceSkillBinding> = {},
): AgentRuntimeWorkspaceSkillBinding {
  return {
    key: overrides.key ?? "workspace_skill:daily_brief",
    name: overrides.name ?? "每日简报",
    description: overrides.description ?? "整理趋势简报",
    directory: overrides.directory ?? "daily_brief",
    registered_skill_directory:
      overrides.registered_skill_directory ?? "skills/daily_brief",
    registration: overrides.registration ?? {},
    permission_summary: overrides.permission_summary ?? [],
    metadata: overrides.metadata ?? {},
    allowed_tools: overrides.allowed_tools ?? [],
    resource_summary: overrides.resource_summary ?? {},
    standard_compliance: overrides.standard_compliance ?? {},
    runtime_binding_target: overrides.runtime_binding_target ?? "local_cli",
    binding_status: overrides.binding_status ?? "ready_for_manual_enable",
    binding_status_reason: overrides.binding_status_reason ?? "",
    next_gate: overrides.next_gate ?? "manual_enable",
    query_loop_visible: overrides.query_loop_visible ?? true,
    tool_runtime_visible: overrides.tool_runtime_visible ?? true,
    launch_enabled: overrides.launch_enabled ?? false,
    runtime_gate: overrides.runtime_gate ?? "manual_enable",
  };
}

describe("useExpertWorkspaceSkillRuntime model", () => {
  it("应从 workspace skill ref 提取目录并忽略版本后缀", () => {
    expect(
      workspaceSkillDirectoryFromRef("workspace_skill:Daily_Brief@v2"),
    ).toBe("Daily_Brief");
    expect(workspaceSkillDirectoryFromRef(" skills/daily_brief ")).toBe(
      "skills/daily_brief",
    );
  });

  it("应从 expert 或 harness.expert metadata 解析稳定 runtime key", () => {
    expect(
      resolveExpertWorkspaceSkillRuntimeKey({
        expert: {
          id: "expert-a",
          releaseId: "release-1",
        },
      }),
    ).toBe("expert-a:release-1");

    expect(
      resolveExpertWorkspaceSkillRuntimeKey({
        harness: {
          expert: {
            expert_id: "expert-b",
            version: "v2",
          },
        },
      }),
    ).toBe("expert-b:v2");
  });

  it("应按 key、directory、registered directory 和 name 匹配 binding", () => {
    const bindings = [
      createBinding({
        key: "workspace_skill:report_writer",
        name: "研报写手",
        directory: "report_writer",
        registered_skill_directory: "/repo/.lime/skills/report_writer",
      }),
    ];

    expect(findWorkspaceSkillBindingByRef(bindings, "report_writer")?.key).toBe(
      "workspace_skill:report_writer",
    );
    expect(
      findWorkspaceSkillBindingByRef(bindings, "workspace_skill:REPORT_WRITER")
        ?.key,
    ).toBe("workspace_skill:report_writer");
    expect(findWorkspaceSkillBindingByRef(bindings, "研报写手")?.key).toBe(
      "workspace_skill:report_writer",
    );
  });

  it("启用列表只保留 ready_for_manual_enable binding 并去重", () => {
    const ready = createBinding({
      key: "workspace_skill:daily_brief",
      directory: "daily_brief",
    });
    const blocked = createBinding({
      key: "workspace_skill:blocked_skill",
      directory: "blocked_skill",
      binding_status: "blocked",
    });

    expect(
      resolveExpertWorkspaceSkillRuntimeEnableBindings(
        [ready, blocked],
        [
          "workspace_skill:daily_brief",
          "daily_brief@v2",
          "workspace_skill:blocked_skill",
        ],
      ).map((binding) => binding.key),
    ).toEqual(["workspace_skill:daily_brief"]);
  });

  it("技能引用变化时应裁掉不再存在的 workspace skill runtime enable ref", () => {
    expect(
      filterExpertWorkspaceSkillRuntimeEnableRefsForSkillRefs(
        ["workspace_skill:daily_brief", "workspace_skill:report_writer"],
        ["workspace_skill:report_writer@v2", "builtin:image_generate"],
      ),
    ).toEqual(["workspace_skill:report_writer"]);
  });

  it("重复启用同一 workspace skill 目录时应保持原列表", () => {
    const current = ["workspace_skill:daily_brief"];

    expect(
      appendExpertWorkspaceSkillRuntimeEnableRef(current, "daily_brief@v2"),
    ).toEqual(current);
    expect(
      appendExpertWorkspaceSkillRuntimeEnableRef(current, "report_writer"),
    ).toEqual(["workspace_skill:daily_brief", "report_writer"]);
  });
});
