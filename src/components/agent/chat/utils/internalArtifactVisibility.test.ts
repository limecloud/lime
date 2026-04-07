import { describe, expect, it } from "vitest";
import { isHiddenInternalArtifactPath } from "./internalArtifactVisibility";

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
});
