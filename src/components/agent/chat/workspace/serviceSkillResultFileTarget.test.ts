import { describe, expect, it } from "vitest";
import type { AgentThreadItem, SiteSavedContentTarget } from "../types";
import { resolvePreferredServiceSkillResultFileTarget } from "./serviceSkillResultFileTarget";

function createFileArtifactItem(
  overrides: Partial<Extract<AgentThreadItem, { type: "file_artifact" }>>,
): Extract<AgentThreadItem, { type: "file_artifact" }> {
  return {
    id: "artifact-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence: 1,
    status: "completed",
    started_at: "2026-04-10T10:00:00Z",
    completed_at: "2026-04-10T10:00:01Z",
    updated_at: "2026-04-10T10:00:01Z",
    type: "file_artifact",
    path: "workspace/index.md",
    source: "write_file",
    content: "# Index\n\n正文",
    ...overrides,
  };
}

describe("serviceSkillResultFileTarget", () => {
  it("应优先选择同回合里脱离源导出 bundle 的正式 index.md", () => {
    const savedContentTarget: SiteSavedContentTarget = {
      projectId: "project-1",
      contentId: "content-1",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/google-cloud/index.md",
      },
    };

    const target = resolvePreferredServiceSkillResultFileTarget({
      savedContentTarget,
      threadItems: [
        createFileArtifactItem({
          id: "artifact-source",
          path: "exports/x-article-export/google-cloud/index.md",
          sequence: 2,
        }),
        createFileArtifactItem({
          id: "artifact-agents",
          path: "workspace/Agents.md",
          sequence: 3,
        }),
        createFileArtifactItem({
          id: "artifact-final",
          path: "workspace/index.md",
          sequence: 4,
        }),
      ],
    });

    expect(target).toEqual({
      relativePath: "workspace/index.md",
      title: "index.md",
    });
  });

  it("只有源导出 bundle 时应返回 null，交给 saved_content 兜底", () => {
    const savedContentTarget: SiteSavedContentTarget = {
      projectId: "project-1",
      contentId: "content-1",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/google-cloud/index.md",
      },
    };

    const target = resolvePreferredServiceSkillResultFileTarget({
      savedContentTarget,
      threadItems: [
        createFileArtifactItem({
          id: "artifact-source",
          path: "exports/x-article-export/google-cloud/index.md",
          sequence: 4,
        }),
      ],
    });

    expect(target).toBeNull();
  });

  it("导出到其他正式目录时也应优先打开结果 index.md", () => {
    const savedContentTarget: SiteSavedContentTarget = {
      projectId: "project-1",
      contentId: "content-1",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/google-cloud/index.md",
      },
    };

    const target = resolvePreferredServiceSkillResultFileTarget({
      savedContentTarget,
      threadItems: [
        createFileArtifactItem({
          id: "artifact-final",
          path: "exports/social-article/google-cloud/index.md",
          sequence: 6,
        }),
        createFileArtifactItem({
          id: "artifact-agents",
          path: "exports/social-article/google-cloud/Agents.md",
          sequence: 7,
        }),
      ],
    });

    expect(target).toEqual({
      relativePath: "exports/social-article/google-cloud/index.md",
      title: "index.md",
    });
  });
});
