import { beforeEach, describe, expect, it } from "vitest";
import {
  getLatestSceneAppRecentVisit,
  listSceneAppRecentVisits,
  recordSceneAppRecentVisit,
  subscribeSceneAppRecentVisits,
} from "./storage";

describe("sceneapp storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("应记录最近访问的 SceneApp 页面状态", () => {
    const records = recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
        search: "短视频",
      },
      {
        visitedAt: 100,
      },
    );

    expect(records).toEqual([
      expect.objectContaining({
        sceneappId: "story-video-suite",
        projectId: "project-1",
        search: "短视频",
        visitedAt: 100,
      }),
    ]);
    expect(getLatestSceneAppRecentVisit()).toEqual(
      expect.objectContaining({
        sceneappId: "story-video-suite",
      }),
    );
  });

  it("相同 sceneapp 与项目应覆盖旧记录，而不是重复堆积", () => {
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
        search: "初始搜索",
      },
      {
        visitedAt: 100,
      },
    );

    const records = recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
        search: "更新后的搜索",
        runId: "run-2",
      },
      {
        visitedAt: 200,
      },
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        sceneappId: "story-video-suite",
        projectId: "project-1",
        search: "更新后的搜索",
        runId: "run-2",
        visitedAt: 200,
      }),
    );
  });

  it("应按最近时间倒序读取，并忽略非法缓存", () => {
    window.localStorage.setItem(
      "lime:sceneapp-recent-visits:v1",
      JSON.stringify([
        {
          sceneappId: "bad-entry",
          visitedAt: "oops",
        },
        {
          sceneappId: "daily-trend-briefing",
          projectId: "project-2",
          visitedAt: 300,
        },
        {
          sceneappId: "story-video-suite",
          projectId: "project-1",
          visitedAt: 100,
        },
      ]),
    );

    expect(listSceneAppRecentVisits()).toEqual([
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        visitedAt: 300,
      }),
      expect.objectContaining({
        sceneappId: "story-video-suite",
        visitedAt: 100,
      }),
    ]);
  });

  it("写入最近访问时应通知订阅者", () => {
    const received: Array<string | undefined> = [];
    const unsubscribe = subscribeSceneAppRecentVisits((records) => {
      received.push(records[0]?.sceneappId);
    });

    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
      },
      { visitedAt: 500 },
    );

    unsubscribe();

    expect(received).toEqual(["story-video-suite"]);
  });
});
