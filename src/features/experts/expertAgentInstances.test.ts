import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExpertAgentInstanceKey,
  expertAgentInstanceStorageKeys,
  findExpertAgentInstance,
  readExpertAgentInstances,
  updateExpertAgentInstanceSkillRefs,
  upsertExpertAgentInstance,
} from "./expertAgentInstances";

describe("expertAgentInstances", () => {
  beforeEach(() => {
    window.localStorage.clear();

    vi.unstubAllGlobals();
  });

  it("应以 catalog/project/expert/release 生成配置 key 并复用记录", () => {
    const identity = {
      catalogId: "tenant-0001",
      projectId: "project-a",
      expertId: "marketing-strategist",
      releaseId: "rel-1",
    };

    const first = upsertExpertAgentInstance({
      ...identity,
      skillRefsOverride: ["skill:csv"],
      now: 100,
    });
    const second = upsertExpertAgentInstance({
      ...identity,
      skillRefsOverride: ["skill:xlsx"],
      now: 200,
    });

    expect(first.agentInstanceKey).toBe(buildExpertAgentInstanceKey(identity));
    expect(second.agentInstanceId).toBe(first.agentInstanceId);
    expect(findExpertAgentInstance(identity)?.skillRefsOverride).toEqual([
      "skill:xlsx",
    ]);
    expect(readExpertAgentInstances()).toHaveLength(1);
  });

  it("不同项目下不应复用同一专家配置", () => {
    const baseIdentity = {
      catalogId: "tenant-0001",
      expertId: "marketing-strategist",
      releaseId: "rel-1",
    };

    upsertExpertAgentInstance({
      ...baseIdentity,
      projectId: "project-a",
      skillRefsOverride: ["skill:csv"],
      now: 100,
    });
    upsertExpertAgentInstance({
      ...baseIdentity,
      projectId: "project-b",
      skillRefsOverride: ["skill:xlsx"],
      now: 200,
    });

    expect(
      findExpertAgentInstance({ ...baseIdentity, projectId: "project-a" })
        ?.skillRefsOverride,
    ).toEqual(["skill:csv"]);
    expect(
      findExpertAgentInstance({ ...baseIdentity, projectId: "project-b" })
        ?.skillRefsOverride,
    ).toEqual(["skill:xlsx"]);
    expect(findExpertAgentInstance(baseIdentity)).toBeNull();
  });

  it("应持久化项目作用域下的技能覆盖", () => {
    const record = updateExpertAgentInstanceSkillRefs({
      catalogId: "tenant-0001",
      projectId: "project-a",
      expertId: "data-analyst",
      releaseId: "rel-data",
      skillRefsOverride: ["skill:csv", "skill:csv"],
    });

    expect(record?.skillRefsOverride).toEqual(["skill:csv"]);

    updateExpertAgentInstanceSkillRefs({
      catalogId: "tenant-0001",
      projectId: "project-a",
      expertId: "data-analyst",
      releaseId: "rel-data",
      skillRefsOverride: ["skill:xlsx"],
    });

    expect(
      JSON.parse(
        window.localStorage.getItem(expertAgentInstanceStorageKeys.instances) ||
          "[]",
      )[0],
    ).toMatchObject({
      projectId: "project-a",
      skillRefsOverride: ["skill:xlsx"],
    });
  });

  it("读取旧专家实例缓存时应丢弃 latestSessionId", () => {
    window.localStorage.setItem(
      expertAgentInstanceStorageKeys.instances,
      JSON.stringify([
        {
          catalogId: "tenant-0001",
          projectId: "project-a",
          expertId: "data-analyst",
          releaseId: "rel-data",
          latestSessionId: "session-data",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          lastStartedAt: 1,
        },
      ]),
    );

    expect(readExpertAgentInstances()[0]).not.toHaveProperty("latestSessionId");
  });
});
