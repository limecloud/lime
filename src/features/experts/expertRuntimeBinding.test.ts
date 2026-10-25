import { describe, expect, it } from "vitest";
import { buildExpertCatalogProjection } from "./projectExpertCatalog";
import { buildExpertRuntimeMetadata } from "./expertRuntimeBinding";
import { getSeededExpertCatalog } from "./seededExpertCatalog";
import { createSeededCloudServiceSkillCatalog } from "@/lib/base-setup/seededServiceSkillPackage";

describe("buildExpertRuntimeMetadata", () => {
  it("真实资料整理专家应绑定普通文档 Skill 且不依赖知识平台", () => {
    const catalog = getSeededExpertCatalog();
    const expert = buildExpertCatalogProjection(catalog).items.find(
      (item) => item.id === "knowledge-organizer",
    );
    expect(expert).toBeDefined();
    const metadata = buildExpertRuntimeMetadata(expert!);
    expect(metadata.expert.skillRefs).toEqual([
      "service-skill:personal-ip-knowledge-builder",
    ]);
    expect(metadata.harness.expert.skill_refs).toEqual(
      metadata.expert.skillRefs,
    );
    const skill = createSeededCloudServiceSkillCatalog().items.find(
      (item) => item.id === "personal-ip-knowledge-builder",
    );
    expect(skill?.skillBundle?.name).toBe("personal-ip-knowledge-builder");
    expect(skill?.skillBundle?.metadata?.Lime_skill_bundle_path).toBe(
      "lime-rs/resources/default-skills/personal-ip-knowledge-builder",
    );
    expect(JSON.stringify(skill)).not.toMatch(
      /Lime_knowledge_builder|Lime_knowledge_pack_type|knowledgePack\//,
    );
  });

  it("应把专家 release 转为现有 Agent Runtime request metadata", () => {
    const catalog = getSeededExpertCatalog();
    const projection = buildExpertCatalogProjection(catalog);
    const expert = projection.items.find(
      (item) => item.id === "marketing-strategist",
    );

    expect(expert).toBeDefined();
    const metadata = buildExpertRuntimeMetadata(expert!, {
      catalogVersion: catalog.version,
      tenantId: catalog.tenantId,
    });

    expect(metadata.expert).toMatchObject({
      expertId: "marketing-strategist",
      releaseId: "rel-marketing-strategist-20260515",
      personaRef: "expert-persona:marketing-strategist@1.0.0",
      memoryTemplateRef: "memory-template:marketing-strategist@1.0.0",
      catalogVersion: catalog.version,
    });
    expect(metadata.harness.expert).toMatchObject({
      expert_id: "marketing-strategist",
      release_id: "rel-marketing-strategist-20260515",
      persona_ref: "expert-persona:marketing-strategist@1.0.0",
      memory_enabled: true,
      workflow_enabled: true,
      personality_boundary: {


        expert_persona_scope: "current_expert_session",

        formal_artifact_voice_source: "generation_brief_only",
      },
    });
    expect(metadata.expert.personalityBoundary).toEqual({


      expertPersonaScope: "current_expert_session",

      formalArtifactVoiceSource: "generation_brief_only",
    });
    expect(JSON.stringify(metadata)).not.toContain("SOUL.md");
  });

  it("关闭专家记忆或工作流时不应继续注入对应引用", () => {
    const expert = buildExpertCatalogProjection(
      getSeededExpertCatalog(),
    ).items.find((item) => item.id === "marketing-strategist")!;

    const metadata = buildExpertRuntimeMetadata(expert, {
      overlay: {
        expertId: expert.id,
        releaseId: expert.release.releaseId,
        installedAt: 1,
        lastUsedAt: 2,
        memoryEnabled: false,
        workflowEnabled: false,
      },
    });

    expect(metadata.expert.memoryTemplateRef).toBeUndefined();
    expect(metadata.expert.workflowRefs).toEqual([]);
    expect(metadata.harness.expert.memory_template_ref).toBeUndefined();
    expect(metadata.harness.expert.workflow_refs).toEqual([]);
  });
});
