import { describe, expect, it } from "vitest";
import { parseArtifactOpsString, parseArtifactOpsValue } from "./ops";

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
});
