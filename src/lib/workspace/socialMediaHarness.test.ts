import { describe, expect, it } from "vitest";
import { resolveSocialMediaArtifactDescriptor } from "./socialMediaHarness";

describe("resolveSocialMediaArtifactDescriptor", () => {
  it("应识别 brief.md 为需求简报阶段", () => {
    const result = resolveSocialMediaArtifactDescriptor({
      fileName: "brief.md",
      gateKey: "topic_select",
    });

    expect(result.artifactType).toBe("brief");
    expect(result.stage).toBe("briefing");
    expect(result.versionLabel).toBe("需求简报");
  });

  it("应将写作阶段的社媒主稿映射为初稿", () => {
    const result = resolveSocialMediaArtifactDescriptor({
      fileName: "social-posts/demo-post.md",
      gateKey: "write_mode",
      runTitle: "写作阶段",
    });

    expect(result.artifactType).toBe("draft");
    expect(result.stage).toBe("drafting");
    expect(result.versionLabel).toBe("社媒初稿");
    expect(result.artifactId).toContain("social-media:draft:demo-post");
  });

  it("应识别平台适配产物与平台类型", () => {
    const result = resolveSocialMediaArtifactDescriptor({
      fileName: "social-posts/xiaohongshu-note.md",
      gateKey: "publish_confirm",
      runTitle: "发布小红书版本",
    });

    expect(result.artifactType).toBe("platform_variant");
    expect(result.stage).toBe("adapting");
    expect(result.platform).toBe("xiaohongshu");
    expect(result.versionLabel).toBe("平台适配 · 小红书");
  });

  it("应识别发布包 JSON 为发布准备阶段", () => {
    const result = resolveSocialMediaArtifactDescriptor({
      fileName: "social-posts/demo-post.publish-pack.json",
      gateKey: "publish_confirm",
    });

    expect(result.artifactType).toBe("publish_package");
    expect(result.stage).toBe("publish_prep");
    expect(result.isAuxiliary).toBe(true);
    expect(result.branchKey).toBe("demo-post");
  });
});
