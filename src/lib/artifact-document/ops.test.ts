import { describe, expect, it } from "vitest";
import {
  parseArtifactIncrementalString,
  parseArtifactOperationCandidateString,
  parseArtifactOpsString,
  parseArtifactOpsValue,
  parseArtifactRewritePatchString,
} from "./ops";

describe("artifact-document ops", () => {
  it("应解析 artifact_ops 字符串包络", () => {
    const envelope = parseArtifactOpsString(`
      {
        "type": "artifact_ops",
        "artifactId": "artifact-document:demo",
        "ops": [
          {
            "op": "artifact.upsert_block",
            "block": {
              "id": "body-1",
              "type": "rich_text",
              "markdown": "改写后的正文"
            }
          },
          {
            "op": "artifact.finalize_version",
            "summary": "只更新了正文"
          }
        ]
      }
    `);

    expect(envelope).not.toBeNull();
    expect(envelope?.type).toBe("artifact_ops");
    expect(envelope?.ops).toHaveLength(2);
    expect(envelope?.ops[0]).toMatchObject({
      op: "artifact.upsert_block",
      block: {
        id: "body-1",
        type: "rich_text",
      },
    });
  });

  it("应拒绝缺少有效 op 的包络", () => {
    expect(
      parseArtifactOpsValue({
        type: "artifact_ops",
        ops: [
          {
            op: "artifact.upsert_block",
          },
        ],
      }),
    ).toBeNull();
  });

  it("应解析正式单条增量 op", () => {
    const envelope = parseArtifactIncrementalString(`
      {
        "type": "artifact.block.upsert",
        "artifactId": "artifact-document:demo",
        "block": {
          "id": "body-1",
          "type": "rich_text",
          "contentFormat": "markdown",
          "content": "改写后的正文"
        }
      }
    `);

    expect(envelope).not.toBeNull();
    expect(envelope).toMatchObject({
      type: "artifact.block.upsert",
      artifactId: "artifact-document:demo",
      block: {
        id: "body-1",
        type: "rich_text",
      },
    });
  });

  it("应解析 rewrite patch 并兼容 snake_case / camelCase", () => {
    const envelope = parseArtifactRewritePatchString(`
      {
        "type": "artifact_rewrite_patch",
        "artifact_id": "artifact-document:demo",
        "target_block_id": "body-1",
        "block": {
          "id": "body-1",
          "type": "rich_text",
          "contentFormat": "markdown",
          "content": "只改这一段"
        },
        "source": {
          "id": "source-1",
          "type": "web",
          "label": "官方文档"
        },
        "summary": "更新目标段落"
      }
    `);

    expect(envelope).not.toBeNull();
    expect(envelope).toMatchObject({
      type: "artifact_rewrite_patch",
      artifactId: "artifact-document:demo",
      targetBlockId: "body-1",
      block: {
        id: "body-1",
        type: "rich_text",
      },
      source: {
        id: "source-1",
        label: "官方文档",
      },
      summary: "更新目标段落",
    });
  });

  it("应优先按 current-first 顺序解析统一 operation candidate", () => {
    expect(
      parseArtifactOperationCandidateString(`
        {
          "type": "artifact.block.upsert",
          "artifactId": "artifact-document:demo",
          "block": {
            "id": "body-1",
            "type": "rich_text",
            "contentFormat": "markdown",
            "content": "增量正文"
          }
        }
      `),
    ).toMatchObject({
      type: "artifact.block.upsert",
      artifactId: "artifact-document:demo",
    });

    expect(
      parseArtifactOperationCandidateString(`
        {
          "type": "artifact_rewrite_patch",
          "artifactId": "artifact-document:demo",
          "targetBlockId": "body-1",
          "block": {
            "id": "body-1",
            "type": "rich_text",
            "contentFormat": "markdown",
            "content": "rewrite 正文"
          }
        }
      `),
    ).toMatchObject({
      type: "artifact_rewrite_patch",
      artifactId: "artifact-document:demo",
      targetBlockId: "body-1",
    });

    expect(
      parseArtifactOperationCandidateString(`
        {
          "type": "artifact_ops",
          "artifactId": "artifact-document:demo",
          "ops": [
            {
              "op": "artifact.finalize_version",
              "summary": "兼容回退"
            }
          ]
        }
      `),
    ).toMatchObject({
      type: "artifact_ops",
      artifactId: "artifact-document:demo",
    });
  });
});
