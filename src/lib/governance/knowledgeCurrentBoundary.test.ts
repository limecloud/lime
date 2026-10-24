/* global process */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "./legacySurfaceCatalog.json";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("retired knowledge platform boundary", () => {
  it("独立知识平台所有者和专用执行链必须保持删除", () => {
    const boundary = catalog.imports.find(
      (entry) => entry.id === "knowledge-page-legacy-component-split",
    );
    expect(boundary?.classification).toBe("dead");
    for (const path of boundary!.targets) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(false);
    }
  });

  it("公开协议与客户端不得重新登记知识包方法", () => {
    const files = [
      "lime-rs/crates/app-server-protocol/src/protocol/v0/method_names.rs",
      "lime-rs/crates/app-server-protocol/schema/json/app_server_protocol.schemas.json",
      "packages/app-server-client/src/protocol.ts",
      "packages/app-server-client/src/generated/protocol-types.ts",
      "packages/app-server-client/src/request-client.ts",
      "packages/app-server-client/src/connection-methods.ts",
    ];
    for (const path of files) {
      expect(readRepoFile(path), path).not.toMatch(
        /knowledgePack\/|knowledgeContext\/|knowledgeContextRun\/|Knowledge(?:ListPacks|CompilePack|ResolveContext)/,
      );
    }
  });

  it("导航与 Composer 不再透传旧页面或知识状态", () => {
    for (const path of [
      "src/types/page.ts",
      "src/components/AppPageContent.tsx",
      "src/lib/navigation/sidebarNav.ts",
      "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
    ]) {
      expect(readRepoFile(path), path).not.toMatch(
        /KnowledgePage|initialKnowledgePackSelection|useWorkspaceKnowledgeRuntime|onManageKnowledgePacks/,
      );
    }
    const manifest = JSON.parse(readRepoFile("package.json"));
    expect(
      Object.keys(manifest.scripts).some(
        (name) =>
          name.startsWith("knowledge:") || name.startsWith("smoke:knowledge"),
      ),
    ).toBe(false);
  });
});
