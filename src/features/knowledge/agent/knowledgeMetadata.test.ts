import { describe, expect, it } from "vitest";
import {
  buildKnowledgeRequestMetadata,
  buildKnowledgeBuilderMetadata,
  resolveKnowledgeRequestCompanionPacks,
  resolveKnowledgePackRuntimeMode,
  resolveKnowledgeBuilderSkill,
} from "./knowledgeMetadata";
import type { KnowledgePackSummary } from "@/lib/api/knowledge";

function buildPack(
  name: string,
  params: {
    type?: string;
    mode?: "persona" | "data";
    status?: string;
    defaultForWorkspace?: boolean;
  } = {},
): KnowledgePackSummary {
  return {
    metadata: {
      name,
      description: name,
      type: params.type ?? "brand-product",
      status: params.status ?? "ready",
      maintainers: [],
      runtime: params.mode ? { mode: params.mode } : null,
    },
    rootPath: `/tmp/project/.lime/knowledge/packs/${name}`,
    knowledgePath: `/tmp/project/.lime/knowledge/packs/${name}/KNOWLEDGE.md`,
    defaultForWorkspace: params.defaultForWorkspace ?? false,
    updatedAt: 1,
    sourceCount: 1,
    wikiCount: 1,
    compiledCount: 1,
    runCount: 1,
    preview: null,
  };
}

describe("knowledgeMetadata", () => {
  it("应把个人 IP 整理请求指向内置 Builder Skill", () => {
    expect(resolveKnowledgeBuilderSkill({ packType: "personal-ip" })).toEqual(
      expect.objectContaining({
        skillKind: "agent-skill",
        skillName: "personal-ip-knowledge-builder",
        normalizedPackType: "personal-profile",
        limeTemplate: "personal-ip",
        family: "persona",
        runtimeMode: "persona",
        deprecated: false,
      }),
    );

    expect(
      buildKnowledgeBuilderMetadata({
        workingDir: "/tmp/project",
        packName: "founder-personal-ip",
        source: "knowledge_page",
        packType: "personal-profile",
      }),
    ).toEqual({
      knowledge_builder: expect.objectContaining({
        kind: "agent-skill",
        skill_name: "personal-ip-knowledge-builder",
        pack_type: "personal-profile",
        lime_template: "personal-ip",
        family: "persona",
        runtime_mode: "persona",
        pack_name: "founder-personal-ip",
        working_dir: "/tmp/project",
        source: "knowledge_page",
        deprecated: false,
      }),
    });
  });

  it("应把品牌人设整理请求指向内置 Builder Skill", () => {
    expect(
      buildKnowledgeBuilderMetadata({
        workingDir: "/tmp/project",
        packName: "official-brand",
        source: "knowledge_page",
        packType: "brand-persona",
      }),
    ).toEqual({
      knowledge_builder: {
        kind: "agent-skill",
        skill_name: "brand-persona-knowledge-builder",
        pack_type: "brand-persona",
        lime_template: "brand-persona",
        family: "persona",
        runtime_mode: "persona",
        pack_name: "official-brand",
        working_dir: "/tmp/project",
        source: "knowledge_page",
        deprecated: false,
        bundle_path:
          "src-tauri/resources/default-skills/brand-persona-knowledge-builder",
      },
    });
  });

  it("应把内置运营类资料指向对应 Builder Skill", () => {
    expect(
      buildKnowledgeBuilderMetadata({
        workingDir: "/tmp/project",
        packName: "content-calendar",
        source: "inputbar",
        packType: "content-operations",
      }),
    ).toEqual({
      knowledge_builder: {
        kind: "agent-skill",
        skill_name: "content-operations-knowledge-builder",
        pack_type: "content-operations",
        lime_template: "content-operations",
        family: "data",
        runtime_mode: "data",
        pack_name: "content-calendar",
        working_dir: "/tmp/project",
        source: "inputbar",
        deprecated: false,
        bundle_path:
          "src-tauri/resources/default-skills/content-operations-knowledge-builder",
      },
    });
  });

  it("应把品牌产品、组织经验和增长策略资料指向内置 Builder Skill", () => {
    for (const [packType, skillName] of [
      ["brand-product", "brand-product-knowledge-builder"],
      ["organization-knowhow", "organization-knowhow-knowledge-builder"],
      ["growth-strategy", "growth-strategy-knowledge-builder"],
    ] as const) {
      expect(
        buildKnowledgeBuilderMetadata({
          workingDir: "/tmp/project",
          packName: packType,
          source: "inputbar",
          packType,
        }),
      ).toEqual({
        knowledge_builder: {
          kind: "agent-skill",
          skill_name: skillName,
          pack_type: packType,
          lime_template: packType,
          family: "data",
          runtime_mode: "data",
          pack_name: packType,
          working_dir: "/tmp/project",
          source: "inputbar",
          deprecated: false,
          bundle_path: `src-tauri/resources/default-skills/${skillName}`,
        },
      });
    }
  });

  it("应把未知资料类型保留为 compat 但不继续扩张 planned surface", () => {
    expect(
      buildKnowledgeBuilderMetadata({
        workingDir: "/tmp/project",
        packName: "external-playbook",
        source: "inputbar",
        packType: "external-playbook",
      }),
    ).toEqual({
      knowledge_builder: {
        kind: "lime-compat-compiler",
        skill_name: "knowledge_builder",
        pack_type: "external-playbook",
        lime_template: "external-playbook",
        family: "data",
        runtime_mode: "data",
        pack_name: "external-playbook",
        working_dir: "/tmp/project",
        source: "inputbar",
        deprecated: true,
      },
    });
  });

  it("应允许资料使用请求携带协同 pack", () => {
    expect(
      buildKnowledgeRequestMetadata({
        workingDir: "/tmp/project",
        packName: "content-calendar",
        source: "knowledge_page",
        packs: [{ name: "founder-persona", activation: "implicit" }],
      }),
    ).toEqual({
      knowledge_pack: expect.objectContaining({
        pack_name: "content-calendar",
        working_dir: "/tmp/project",
        source: "knowledge_page",
        packs: [{ name: "founder-persona", activation: "implicit" }],
      }),
    });
  });

  it("应把 data pack 的默认 ready persona 作为隐式协同 pack", () => {
    expect(
      resolveKnowledgePackRuntimeMode(
        buildPack("founder", { type: "personal-ip" }),
      ),
    ).toBe("persona");
    expect(
      resolveKnowledgeRequestCompanionPacks({
        primaryPackName: "content-calendar",
        packs: [
          buildPack("content-calendar", { type: "content-operations" }),
          buildPack("founder-persona", {
            type: "personal-profile",
            defaultForWorkspace: true,
          }),
          buildPack("draft-persona", {
            type: "personal-profile",
            status: "needs-review",
          }),
        ],
      }),
    ).toEqual([{ name: "founder-persona", activation: "implicit" }]);
  });

  it("应允许在默认 persona 之外显式追加多个 data pack", () => {
    expect(
      resolveKnowledgeRequestCompanionPacks({
        primaryPackName: "content-calendar",
        explicitPackNames: [
          "launch-plan",
          "founder-persona",
          "draft-operations",
          "launch-plan",
        ],
        packs: [
          buildPack("content-calendar", { type: "content-operations" }),
          buildPack("founder-persona", {
            type: "personal-profile",
            defaultForWorkspace: true,
          }),
          buildPack("launch-plan", { type: "campaign-operations" }),
          buildPack("draft-operations", {
            type: "private-domain-operations",
            status: "needs-review",
          }),
        ],
      }),
    ).toEqual([
      { name: "founder-persona", activation: "implicit" },
      { name: "launch-plan", activation: "explicit" },
    ]);
  });

  it("persona pack 本身不应再附加协同 persona", () => {
    expect(
      resolveKnowledgeRequestCompanionPacks({
        primaryPackName: "founder-persona",
        packs: [
          buildPack("founder-persona", { type: "personal-profile" }),
          buildPack("backup-persona", { type: "personal-profile" }),
        ],
      }),
    ).toEqual([]);
  });
});
