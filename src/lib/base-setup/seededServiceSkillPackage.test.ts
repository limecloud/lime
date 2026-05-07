import { describe, expect, it } from "vitest";
import {
  createSeededCloudServiceSkillCatalog,
  createSeededLocalCustomServiceSkillBaseSetupPackage,
  createSeededLocalCustomServiceSkillCatalog,
  createSeededServiceSkillBaseSetupPackage,
  SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID,
  SEEDED_SERVICE_SKILL_CATALOG_VERSION,
} from "./seededServiceSkillPackage";

describe("seededServiceSkillPackage", () => {
  it("应提供 seeded 基础设置包事实源", () => {
    const pkg = createSeededServiceSkillBaseSetupPackage();

    expect(pkg.id).toBe("lime-seeded-service-skills");
    expect(pkg.version).toBe(SEEDED_SERVICE_SKILL_CATALOG_VERSION);
    expect(pkg.catalogProjections).toHaveLength(7);
    expect(pkg.automationProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "daily-trend-briefing-automation",
        }),
        expect.objectContaining({
          id: "account-performance-tracking-automation",
        }),
      ]),
    );
    expect(pkg.bindingProfiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(["agent-turn-instant", "automation-job-managed"]),
    );
    expect(pkg.compatibility.requiredKernelCapabilities).not.toContain(
      "cloud_scene",
    );
  });

  it("应提供 seeded 本地定制场景的基础设置包事实源", () => {
    const pkg = createSeededLocalCustomServiceSkillBaseSetupPackage();

    expect(pkg.id).toBe("lime-seeded-local-custom-service-skills");
    expect(pkg.version).toBe(SEEDED_SERVICE_SKILL_CATALOG_VERSION);
    expect(pkg.catalogProjections).toHaveLength(2);
    expect(pkg.catalogProjections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "x-article-export",
          targetCatalog: "service_skill_catalog",
          bindingProfileRef: "browser-assist-instant",
        }),
        expect.objectContaining({
          id: "personal-ip-knowledge-builder",
          targetCatalog: "service_skill_catalog",
          bindingProfileRef: "native-skill-knowledge-builder",
          skillBundleMetadata: expect.objectContaining({
            Lime_knowledge_pack_type: "personal-profile",
            Lime_agent_knowledge_runtime_mode: "persona",
          }),
        }),
      ]),
    );
    expect(pkg.catalogProjections[0]).toEqual(
      expect.objectContaining({
        id: "x-article-export",
        targetCatalog: "service_skill_catalog",
        bindingProfileRef: "browser-assist-instant",
      }),
    );
  });

  it("应把 seeded 基础设置包编译成默认云端目录", () => {
    const catalog = createSeededCloudServiceSkillCatalog();

    expect(catalog.tenantId).toBe(SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID);
    expect(catalog.version).toBe(SEEDED_SERVICE_SKILL_CATALOG_VERSION);
    expect(catalog.items).toHaveLength(7);
    expect(catalog.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "carousel-post-replication",
          title: "复制轮播帖",
          skillBundle: expect.objectContaining({
            name: "carousel-post-replication",
            metadata: expect.objectContaining({
              Lime_base_setup_package_id: "lime-seeded-service-skills",
              Lime_prompt_template_key: "replication",
            }),
          }),
        }),
        expect.objectContaining({
          id: "account-performance-tracking",
          runnerType: "managed",
          defaultExecutorBinding: "automation_job",
          skillBundle: expect.objectContaining({
            metadata: expect.objectContaining({
              Lime_automation_profile_ref:
                "account-performance-tracking-automation",
            }),
          }),
        }),
        expect.objectContaining({
          id: "cloud-video-dubbing",
          title: "视频配音",
          defaultExecutorBinding: "agent_turn",
          executionLocation: "client_default",
        }),
      ]),
    );
  });

  it("应把 seeded 本地定制基础设置包编译成 local_custom 目录项", () => {
    const catalog = createSeededLocalCustomServiceSkillCatalog();

    expect(catalog.tenantId).toBe(SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID);
    expect(catalog.version).toBe(SEEDED_SERVICE_SKILL_CATALOG_VERSION);
    expect(catalog.items).toHaveLength(2);
    expect(catalog.items[0]).toEqual(
      expect.objectContaining({
        id: "x-article-export",
        source: "local_custom",
        runnerType: "instant",
        defaultExecutorBinding: "browser_assist",
        sceneBinding: expect.objectContaining({
          sceneKey: "x-article-export",
          commandPrefix: "/x文章转存",
        }),
        skillBundle: expect.objectContaining({
          metadata: expect.objectContaining({
            Lime_base_setup_package_id:
              "lime-seeded-local-custom-service-skills",
            Lime_executor_binding: "browser_assist",
            Lime_runner_type: "instant",
          }),
        }),
      }),
    );
    expect(catalog.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "personal-ip-knowledge-builder",
          source: "local_custom",
          defaultExecutorBinding: "native_skill",
          skillBundle: expect.objectContaining({
            name: "personal-ip-knowledge-builder",
            resourceSummary: {
              hasScripts: true,
              hasReferences: true,
              hasAssets: true,
            },
            metadata: expect.objectContaining({
              Lime_knowledge_builder: "true",
              Lime_knowledge_pack_type: "personal-profile",
              Lime_knowledge_template: "personal-ip",
              Lime_knowledge_family: "persona",
            }),
          }),
        }),
      ]),
    );
  });
});
