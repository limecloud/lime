import { beforeEach, describe, expect, it } from "vitest";
import {
  hasSceneAppRecentVisit,
  resolveSceneAppsPageEntryParams,
} from "./entry";
import { recordSceneAppRecentVisit } from "./storage";

describe("sceneapp entry", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("browse 模式应保留显式目录参数", () => {
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
      },
      { visitedAt: 100 },
    );

    expect(
      resolveSceneAppsPageEntryParams(
        {
          projectId: "project-2",
          prefillIntent: "继续新的输入",
        },
        {
          mode: "browse",
        },
      ),
    ).toEqual({
      projectId: "project-2",
      prefillIntent: "继续新的输入",
    });
  });

  it("resume_latest 模式应恢复最近一次 SceneApp 上下文", () => {
    recordSceneAppRecentVisit(
      {
        sceneappId: "daily-trend-briefing",
        projectId: "project-3",
        runId: "run-9",
      },
      { visitedAt: 200 },
    );

    expect(
      resolveSceneAppsPageEntryParams(
        {
          projectId: "project-8",
        },
        {
          mode: "resume_latest",
        },
      ),
    ).toEqual({
      sceneappId: "daily-trend-briefing",
      projectId: "project-3",
      runId: "run-9",
    });
  });

  it("prefer_latest 模式应在空参数时优先恢复最近上下文", () => {
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
      },
      { visitedAt: 300 },
    );

    expect(
      resolveSceneAppsPageEntryParams(undefined, {
        mode: "prefer_latest",
      }),
    ).toEqual({
      sceneappId: "story-video-suite",
      projectId: "project-1",
    });
  });

  it("应暴露最近访问可用性判断", () => {
    expect(hasSceneAppRecentVisit()).toBe(false);

    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
      },
      { visitedAt: 100 },
    );

    expect(hasSceneAppRecentVisit()).toBe(true);
  });
});
