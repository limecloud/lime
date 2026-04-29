import { describe, expect, it } from "vitest";
import {
  isHiddenConversationArtifactPath,
  isHiddenInternalArtifactPath,
} from "./internalArtifactVisibility";

describe("isHiddenInternalArtifactPath", () => {
  it("应隐藏 .lime/tasks 下的内部任务快照 JSON", () => {
    expect(
      isHiddenInternalArtifactPath(
        ".lime/tasks/image_generate/task-image-1.json",
      ),
    ).toBe(true);
    expect(
      isHiddenInternalArtifactPath(
        "/workspace/demo/.lime/tasks/image_generate/task-image-1.json",
      ),
    ).toBe(true);
  });

  it("不应隐藏用户可消费的正式产物", () => {
    expect(
      isHiddenInternalArtifactPath("content-posts/demo.publish-pack.json"),
    ).toBe(false);
    expect(
      isHiddenInternalArtifactPath(
        ".lime/artifacts/thread-1/report.artifact.json",
      ),
    ).toBe(false);
    expect(isHiddenInternalArtifactPath("content-posts/demo-cover.png")).toBe(
      false,
    );
  });

  it("聊天区应隐藏 .lime/artifacts 下的内部 artifact 文稿 JSON", () => {
    expect(
      isHiddenConversationArtifactPath(
        ".lime/artifacts/thread-1/report.artifact.json",
      ),
    ).toBe(true);
    expect(
      isHiddenConversationArtifactPath(
        "/workspace/demo/.lime/artifacts/thread-1/report.artifact.json",
      ),
    ).toBe(true);
    expect(
      isHiddenConversationArtifactPath("content-posts/demo.publish-pack.json"),
    ).toBe(false);
    expect(
      isHiddenConversationArtifactPath("exports/x-article/google/index.md"),
    ).toBe(false);
  });
});
