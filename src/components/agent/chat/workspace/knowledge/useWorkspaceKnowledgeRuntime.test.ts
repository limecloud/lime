import { describe, expect, it } from "vitest";
import type {
  KnowledgePackStatus,
  KnowledgePackSummary,
} from "@/lib/api/knowledge";
import { chooseDefaultKnowledgePack } from "./useWorkspaceKnowledgeRuntime";

function buildPack({
  name,
  status,
  defaultForWorkspace = false,
}: {
  name: string;
  status: KnowledgePackStatus;
  defaultForWorkspace?: boolean;
}): KnowledgePackSummary {
  return {
    metadata: {
      name,
      description: name,
      type: "custom",
      status,
      maintainers: [],
    },
    rootPath: "/tmp/project",
    knowledgePath: `/tmp/project/.lime/knowledge/packs/${name}`,
    defaultForWorkspace,
    updatedAt: 1,
    sourceCount: status === "ready" ? 1 : 0,
    wikiCount: 0,
    compiledCount: status === "ready" ? 1 : 0,
    runCount: 0,
    preview: null,
  };
}

describe("chooseDefaultKnowledgePack", () => {
  it("默认资料未确认时应优先选择已确认资料", () => {
    const selected = chooseDefaultKnowledgePack([
      buildPack({
        name: "draft-without-source",
        status: "needs-review",
        defaultForWorkspace: true,
      }),
      buildPack({
        name: "ready-guide",
        status: "ready",
      }),
    ]);

    expect(selected?.metadata.name).toBe("ready-guide");
  });

  it("没有已确认资料时才回退到默认草稿，方便用户进入管理确认", () => {
    const selected = chooseDefaultKnowledgePack([
      buildPack({
        name: "draft-default",
        status: "needs-review",
        defaultForWorkspace: true,
      }),
      buildPack({
        name: "draft-later",
        status: "draft",
      }),
    ]);

    expect(selected?.metadata.name).toBe("draft-default");
  });
});
