import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  saveSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import {
  buildRuntimeInputCapabilityCatalog,
  useRuntimeInputCapabilityCatalog,
  type RuntimeInputCapabilityCatalog,
} from "./runtimeInputCapabilityCatalog";

function buildRuntimeCatalogFixture(): SkillCatalog {
  const seeded = getSeededSkillCatalog();

  return {
    ...seeded,
    entries: [
      ...seeded.entries,
      {
        id: "command:research",
        kind: "command",
        title: "租户搜索",
        summary: "把 @搜索 绑定到租户下发的搜索技能。",
        commandKey: "tenant_research_custom",
        aliases: ["租户搜索"],
        triggers: [{ mode: "mention", prefix: "@租户搜索测试" }],
        binding: {
          skillId: "tenant-research",
          executionKind: "agent_turn",
        },
      },
      {
        id: "scene:campaign-launch",
        kind: "scene",
        title: "新品发布场景",
        summary: "把链接解析、配图和封面串成一条产品链路。",
        sceneKey: "campaign-launch",
        commandPrefix: "/campaign-launch",
        aliases: ["campaign-launch", "launch"],
        executionKind: "agent_turn",
      },
    ],
  };
}

interface HarnessProps {
  onValue: (value: RuntimeInputCapabilityCatalog) => void;
}

function RuntimeInputCapabilityCatalogHarness({ onValue }: HarnessProps) {
  const value = useRuntimeInputCapabilityCatalog();
  onValue(value);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  clearSkillCatalogCache();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  clearSkillCatalogCache();
});

describe("runtimeInputCapabilityCatalog", () => {
  it("应从统一 skill catalog 生成 builtin、scene 与 mention 路由映射", () => {
    const catalog = buildRuntimeCatalogFixture();

    const runtimeCatalog = buildRuntimeInputCapabilityCatalog(catalog);

    expect(
      runtimeCatalog.builtinCommands.some(
        (command) =>
          command.key === "tenant_research_custom" &&
          command.commandPrefix === "@租户搜索测试",
      ),
    ).toBe(true);
    expect(
      runtimeCatalog.sceneCommands.some(
        (command) =>
          command.key === "campaign-launch" &&
          command.commandPrefix === "/campaign-launch",
      ),
    ).toBe(true);
    expect(
      runtimeCatalog.mentionCommandPrefixKeyMap.get("@租户搜索测试"),
    ).toBe("tenant_research_custom");
    expect(
      runtimeCatalog.mentionCommandSkillIdMap.get("tenant_research_custom"),
    ).toBe("tenant-research");
  });

  it("hook 应跟随 skill catalog 变更同步运行时 capability 目录", async () => {
    const snapshots: RuntimeInputCapabilityCatalog[] = [];

    await act(async () => {
      root?.render(
        <RuntimeInputCapabilityCatalogHarness
          onValue={(value) => {
            snapshots.push(value);
          }}
        />,
      );
    });

    expect(
      snapshots.at(-1)?.sceneCommands.some(
        (command) => command.key === "campaign-launch",
      ),
    ).toBe(false);

    await act(async () => {
      saveSkillCatalog(buildRuntimeCatalogFixture(), "bootstrap_sync");
      await Promise.resolve();
    });

    const latest = snapshots.at(-1);
    expect(
      latest?.sceneCommands.some((command) => command.key === "campaign-launch"),
    ).toBe(true);
  });
});
