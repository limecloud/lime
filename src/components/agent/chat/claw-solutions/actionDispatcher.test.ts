import { describe, expect, it } from "vitest";
import {
  enableSubagentPreference,
  resolveClawSolutionLaunch,
  resolveClawSolutionSetupTarget,
} from "./actionDispatcher";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { ClawSolutionPreparation } from "./types";
import { SettingsTabs } from "@/types/settings";

const defaultPreferences: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

describe("claw solution action dispatcher", () => {
  it("应在未开启时启用多代理偏好", () => {
    expect(enableSubagentPreference(defaultPreferences)).toEqual({
      nextToolPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      },
      changed: true,
    });
  });

  it("已开启多代理时应保持原偏好", () => {
    const current = {
      ...defaultPreferences,
      subagent: true,
    };

    expect(enableSubagentPreference(current)).toEqual({
      nextToolPreferences: current,
      changed: false,
    });
  });

  it("应把社媒方案转换为工作区进入载荷", () => {
    const preparation: ClawSolutionPreparation = {
      solutionId: "social-post-starter",
      actionType: "navigate_theme",
      prompt: "请先帮我起草一版社媒内容首稿",
      themeTarget: "social-media",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: false,
      readiness: "ready",
      readinessMessage: "可直接开始",
    };

    expect(resolveClawSolutionLaunch(preparation, defaultPreferences)).toEqual({
      nextToolPreferences: defaultPreferences,
      preferencesChanged: false,
      shouldStartBrowserAssistLoading: false,
      enterWorkspacePayload: {
        prompt: "请先帮我起草一版社媒内容首稿",
        openBrowserAssistOnMount: false,
        toolPreferences: defaultPreferences,
        themeOverride: "social-media",
      },
      usageRecord: {
        solutionId: "social-post-starter",
        actionType: "navigate_theme",
        themeTarget: "social-media",
      },
    });
  });

  it("网页研究简报应在进入工作区前开启联网研究偏好", () => {
    const preparation: ClawSolutionPreparation = {
      solutionId: "web-research-brief",
      actionType: "fill_input",
      prompt: "请围绕这个主题先给我做一版网页研究简报",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: false,
      readiness: "ready",
      readinessMessage: "可直接开始",
    };

    expect(resolveClawSolutionLaunch(preparation, defaultPreferences)).toEqual({
      nextToolPreferences: {
        webSearch: true,
        thinking: false,
        task: false,
        subagent: false,
      },
      preferencesChanged: true,
      shouldStartBrowserAssistLoading: false,
      enterWorkspacePayload: {
        prompt: "请围绕这个主题先给我做一版网页研究简报",
        openBrowserAssistOnMount: false,
        toolPreferences: {
          webSearch: true,
          thinking: false,
          task: false,
          subagent: false,
        },
        themeOverride: undefined,
      },
      usageRecord: {
        solutionId: "web-research-brief",
        actionType: "fill_input",
        themeTarget: null,
      },
    });
  });

  it("应把多代理方案转换为开启 team 模式的载荷", () => {
    const preparation: ClawSolutionPreparation = {
      solutionId: "team-breakdown",
      actionType: "enable_team_mode",
      prompt: "请把这个任务按多代理方式拆解",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: true,
      readiness: "ready",
      readinessMessage: "可直接开始，进入后会启用多代理偏好",
    };

    expect(resolveClawSolutionLaunch(preparation, defaultPreferences)).toEqual({
      nextToolPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      },
      preferencesChanged: true,
      shouldStartBrowserAssistLoading: false,
      enterWorkspacePayload: {
        prompt: "请把这个任务按多代理方式拆解",
        openBrowserAssistOnMount: false,
        toolPreferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: true,
        },
        themeOverride: undefined,
      },
      usageRecord: {
        solutionId: "team-breakdown",
        actionType: "enable_team_mode",
        themeTarget: null,
      },
    });
  });

  it("应把未就绪方案映射到对应配置入口", () => {
    expect(resolveClawSolutionSetupTarget("needs_setup", "missing_model")).toBe(
      SettingsTabs.Providers,
    );
    expect(
      resolveClawSolutionSetupTarget(
        "needs_capability",
        "missing_skill_dependency",
      ),
    ).toBe(SettingsTabs.Skills);
    expect(
      resolveClawSolutionSetupTarget(
        "needs_capability",
        "missing_browser_capability",
      ),
    ).toBe(SettingsTabs.ChromeRelay);
  });
});
