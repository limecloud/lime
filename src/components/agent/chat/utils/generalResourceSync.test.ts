import { describe, expect, it } from "vitest";
import type { Material } from "@/types/material";
import {
  GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX,
  GENERAL_CHAT_RESOURCE_SESSION_TAG_PREFIX,
  GENERAL_CHAT_RESOURCE_TAG,
  buildGeneralChatResourceDescription,
  buildGeneralChatResourceHash,
  buildGeneralChatResourceTags,
  extractGeneralChatResourceHash,
  hasGeneralChatResourceSync,
  inferGeneralChatResourceMaterialType,
} from "./generalResourceSync";

function createMaterial(tags: string[]): Pick<Material, "tags"> {
  return { tags };
}

describe("generalResourceSync", () => {
  it("应基于路径生成稳定 hash 和去重标签", () => {
    const filePath = "/tmp/project/article.md";
    const tags = buildGeneralChatResourceTags(filePath, "session-1");

    expect(tags).toContain(GENERAL_CHAT_RESOURCE_TAG);
    expect(tags).toContain(
      `${GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX}${buildGeneralChatResourceHash(filePath)}`,
    );
    expect(tags).toContain(
      `${GENERAL_CHAT_RESOURCE_SESSION_TAG_PREFIX}session-1`,
    );
  });

  it("应能从标签中提取同步 hash 并识别已同步素材", () => {
    const filePath = "/tmp/project/outline.md";
    const syncedMaterial = createMaterial(
      buildGeneralChatResourceTags(filePath),
    );

    expect(extractGeneralChatResourceHash(syncedMaterial)).toBe(
      buildGeneralChatResourceHash(filePath),
    );
    expect(hasGeneralChatResourceSync([syncedMaterial], filePath)).toBe(true);
    expect(
      hasGeneralChatResourceSync([syncedMaterial], "/tmp/project/other.md"),
    ).toBe(false);
  });

  it("应根据文件扩展名推断可入库类型", () => {
    expect(inferGeneralChatResourceMaterialType("cover.png")).toBe("image");
    expect(inferGeneralChatResourceMaterialType("voice.mp3")).toBe("audio");
    expect(inferGeneralChatResourceMaterialType("clip.mp4")).toBe("video");
    expect(inferGeneralChatResourceMaterialType("draft.md")).toBe("document");
    expect(inferGeneralChatResourceMaterialType("script.ts")).toBe("document");
    expect(
      inferGeneralChatResourceMaterialType(
        ".lime/tasks/image_generate/task-image-1.json",
      ),
    ).toBeNull();
    expect(
      inferGeneralChatResourceMaterialType(
        "/workspace/demo/.lime/tasks/image_generate/task-image-1.json",
      ),
    ).toBeNull();
    expect(inferGeneralChatResourceMaterialType("   ")).toBeNull();
  });

  it("应生成可读的自动入库说明", () => {
    expect(buildGeneralChatResourceDescription("session-42")).toBe(
      "通用对话自动入库 · 会话 session-42",
    );
    expect(buildGeneralChatResourceDescription()).toBe("通用对话自动入库");
  });
});
