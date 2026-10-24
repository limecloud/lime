import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LIVE_PROVIDER_SMOKE_ENV,
  REAL_API_TEST_ENV,
  assertLiveProviderSmokeAllowed,
  isLiveProviderTestPath,
  liveProviderSmokeAllowed,
  liveProviderSmokeEnv,
} from "./live-provider-smoke-gate.mjs";

const CHILD_PROCESS_TIMEOUT_MS = 15_000;
const CHILD_PROCESS_TEST_TIMEOUT_MS = 20_000;

describe("live-provider-smoke-gate", () => {
  it("默认禁止 live Provider smoke", () => {
    expect(liveProviderSmokeAllowed({})).toBe(false);
  });

  it("显式环境变量允许 live Provider smoke", () => {
    expect(liveProviderSmokeAllowed({ [LIVE_PROVIDER_SMOKE_ENV]: "1" })).toBe(
      true,
    );
    expect(liveProviderSmokeAllowed({ [REAL_API_TEST_ENV]: "true" })).toBe(
      true,
    );
  });

  it("禁止时应给出明确的显式开启提示", () => {
    expect(() =>
      assertLiveProviderSmokeAllowed({
        allowed: false,
        scriptName: "smoke:test",
      }),
    ).toThrow(/--allow-live-provider/);
  });

  it("透传子进程 env 时应只补允许标记", () => {
    expect(liveProviderSmokeEnv({ NODE_ENV: "test" })).toEqual({
      NODE_ENV: "test",
      [LIVE_PROVIDER_SMOKE_ENV]: "1",
    });
  });

  it("应识别 live Provider 测试文件路径", () => {
    expect(isLiveProviderTestPath("src/example/provider.live.test.ts")).toBe(
      true,
    );
    expect(isLiveProviderTestPath("src\\example\\provider.live.test.ts")).toBe(
      true,
    );
    expect(
      isLiveProviderTestPath("src/components/image-gen/useImageGen.test.ts"),
    ).toBe(false);
  });

  it(
    "Vitest 智能入口默认应阻断直接点名 live Provider 测试",
    () => {
      const result = spawnSync(
        "node",
        ["scripts/run-vitest-smart.mjs", "src/example/provider.live.test.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: CHILD_PROCESS_TIMEOUT_MS,
          env: {
            ...process.env,
            [LIVE_PROVIDER_SMOKE_ENV]: "",
            [REAL_API_TEST_ENV]: "",
          },
        },
      );

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("默认禁止执行");
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  it("Claw streaming GUI E2E 是显式 live 入口，不应再接入二次授权 gate", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "scripts/claw-chat-ready-streaming-smoke.mjs"),
      "utf8",
    );

    expect(content).not.toContain("./lib/live-provider-smoke-gate.mjs");
    expect(content).not.toContain("assertLiveProviderSmokeAllowed(");
    expect(content).not.toContain("liveProviderSmokeAllowed(");
    expect(content).not.toContain("allowLiveProvider");
    expect(content).not.toContain("--allow-live-provider");
    expect(content).toContain('logStage("wait-health")');
  });

  it("Claw streaming GUI E2E 自动选型应优先工具调用更稳的模型", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "scripts/claw-chat-ready-streaming-smoke.mjs"),
      "utf8",
    );

    expect(content).toContain("function modelLooksLightweight(");
    expect(content).toContain("function modelLooksExpensive(");
    expect(content).toContain("function modelLooksToolReliable(");
    expect(content).toContain("modelLooksToolReliable(value)");
    expect(content).toContain("modelLooksLightweight(model)");
    expect(content).toContain("modelLooksExpensive(model)");
    expect(content).toContain("candidateRank(candidate)");
    expect(content).toContain("modelPenalty");
    expect(content).toContain("? 12");
    expect(content).toContain("? 18");
  });

  it("Claw streaming GUI E2E 必须要求真实 WebSearch/WebFetch 工具事实", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "scripts/claw-chat-ready-streaming-smoke.mjs"),
      "utf8",
    );

    expect(content).toContain("e2eBoundary");
    expect(content).toContain('"playwright-chromium"');
    expect(content).toContain('"chromium.launchPersistentContext"');
    expect(content).toContain('"DevBridge transport=electron-host"');
    expect(content).toContain("electronRendererIpcE2e: false");
    expect(content).toContain("electronLaunch: false");
    expect(content).toContain(
      "它不是 Playwright _electron.launch() renderer IPC E2E。",
    );
    expect(content).toContain("LIVE_WEB_TOOL_PROMPT");
    expect(content).toContain("@搜索 关键词:联网工具验证");
    expect(content).toContain("webSearch=true");
    expect(content).toContain('searchMode="required"');
    expect(content).toContain("REQUIRED_LIVE_WEB_TOOL_NAMES");
    expect(content).toContain("./lib/claw-chat-live-web-tool-evidence.mjs");
    expect(content).toContain("liveWebToolEvidenceFromSession");
    expect(content).toContain("liveWebToolStreamEvidenceFromEvents");
    expect(content).toContain("turnId: liveWebTurnId");
    expect(content).toContain("allRequiredCompletedForTurn");
    expect(content).toContain("allRequiredOutputPresentForTurn");
    expect(content).toContain("liveWebReadAfterEvent");
    expect(content).toContain("liveWebSessionReadTurn");
    expect(content).toContain("liveWebAppServerEvent");
    expect(content).toContain("strictEventScope");
    expect(content).toContain("{ strictEventScope: true }");
    expect(content).toContain("appServerEventRecords(invokes).find");
    expect(content).toContain("eventRecordMatchesTurn(record");
    expect(content).toContain("eventRecordStrictlyMatchesTurn(record");
    expect(content).toContain("liveWebCurrentStreamingEvent");
    expect(content).toContain("liveWebToolStreamEvidence");
    expect(content).toContain("summary.assertions.liveWebAppServerEventSeen");
    expect(content).toContain(
      "summary.assertions.liveWebSessionReadAfterEventSeen",
    );
    expect(content).toContain("summary.assertions.liveWebSearchToolEventsSeen");
    expect(content).toContain("summary.assertions.liveWebFetchToolEventsSeen");
    expect(content).toContain(
      "summary.assertions.liveWebRequiredToolEventsSeen",
    );
    expect(content).toContain(
      "summary.assertions.liveWebRequiredToolEventOutputsPresent",
    );
    expect(content).toContain(
      "summary.assertions.liveWebRequiredToolEventOrderValid",
    );
    expect(content).toContain(
      "summary.assertions.liveWebTurnCompletedEventSeen",
    );
    expect(content).toContain(
      "等待 read model 出现 live WebSearch/WebFetch 工具输出事实",
    );
    expect(content).toContain("summary.assertions.liveWebSearchCompleted");
    expect(content).toContain("summary.assertions.liveWebFetchCompleted");
    expect(content).toContain(
      "summary.assertions.liveWebProviderPreferenceHonored",
    );
    expect(content).toContain(
      "summary.assertions.liveWebModelPreferenceHonored",
    );
    expect(content).toContain(
      "summary.assertions.liveWebRequiredToolsCompleted",
    );
    expect(content).toContain(
      "summary.assertions.liveWebRequiredToolOutputsPresent",
    );
    expect(content).toContain(
      "summary.assertions.liveWebExplicitSearchRequired",
    );
    expect(content).toContain("submit-live-web-tools-turn");
    expect(content).toContain("failureCleanupLiveWebInterrupt");
  });

  it("Claw streaming GUI E2E 应允许长 turn 快速完成后继续验证 live Web 工具", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "scripts/claw-chat-ready-streaming-smoke.mjs"),
      "utf8",
    );

    expect(content).toContain("longTurnFastCompletedBeforeInterrupt");
    expect(content).toContain("fastCompletedBeforeInterrupt: true");
    expect(content).toContain("long-turn-fast-completed-before-stop");
    expect(content).toContain("longTurnFastCompleteAccepted");
    expect(content).toContain("longTurnCanBeInterrupted");
    expect(content).toContain(
      "(summary.assertions.longTurnCanBeInterrupted ||",
    );
    expect(content).toContain(
      "summary.assertions.longTurnFastCompleteAccepted) &&",
    );
    expect(content).not.toContain(
      '["failed", "aborted", "completed"].includes(turn.status)',
    );
  });

  it("Claw streaming GUI E2E 的 WebSearch/WebFetch helper 必须定义真实联网工具集合", () => {
    const content = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/lib/claw-chat-live-web-tool-evidence.mjs",
      ),
      "utf8",
    );

    expect(content).toContain('["WebSearch", "WebFetch"]');
    expect(content).toContain("export function liveWebToolEvidenceFromSession");
    expect(content).toContain(
      "export function liveWebToolStreamEvidenceFromEvents",
    );
    expect(content).toContain("export function collectToolCallsFromValue");
    expect(content).toContain("export function toolCallMatchesTurn");
    expect(content).toContain("value.result");
    expect(content).toContain("value.detail");
    expect(content).toContain("requiredForTurn");
    expect(content).toContain("allRequiredCompletedForTurn");
    expect(content).toContain("allRequiredOutputPresentForTurn");
    expect(content).toContain("allRequiredToolEventsForTurn");
    expect(content).toContain("allRequiredResultAfterStartForTurn");
    expect(content).toContain("terminalEventSeen");
    expect(content).toContain("outputPresent");
  });

  it("Claw streaming GUI E2E 的 WebSearch/WebFetch 判定必须有行为单测覆盖 turn scope", () => {
    const content = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/lib/claw-chat-live-web-tool-evidence.test.mjs",
      ),
      "utf8",
    );

    expect(content).toContain("liveWebToolEvidenceFromSession");
    expect(content).toContain("liveWebToolStreamEvidenceFromEvents");
    expect(content).toContain("allRequiredCompletedForTurn");
    expect(content).toContain("requiredForTurn");
    expect(content).toContain("turnScopedToolCalls");
    expect(content).toContain('"old-turn"');
    expect(content).toContain('"live-turn"');
    expect(content).toContain("toolCallMatchesTurn");
    expect(content).toContain("toolCallTurnId");
    expect(content).toContain("result.detail");
    expect(content).toContain("output present");
    expect(content).toContain("缺少明确 session/turn scope");
    expect(content).toContain("allRequiredResultAfterStartForTurn");
    expect(content).toContain("allRequiredToolEventsForTurn).toBe(false)");
  });

  it("提交真实 AgentRuntime / Provider 的脚本必须默认接入 live gate", () => {
    const riskyCommandPattern =
      /"agent_runtime_submit_turn"|"test_api_key_provider_chat"|"modelProvider\/testChat"/;
    const explicitLiveEntrypoints = new Set([
      "scripts/claw-chat-ready-streaming-smoke.mjs",
    ]);
    const violations = listSmokeScripts()
      .filter(({ relativePath }) => !explicitLiveEntrypoints.has(relativePath))
      .filter(({ content }) => riskyCommandPattern.test(content))
      .filter(({ content }) => {
        const hasLiveGate = content.includes("assertLiveProviderSmokeAllowed(");
        const hasDefaultNoSubmitPath =
          content.includes("if (!options.allowLiveProvider)") &&
          content.includes("not_submitted") &&
          content.includes("默认未提交");
        return !hasLiveGate && !hasDefaultNoSubmitPath;
      })
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });
});

function listSmokeScripts() {
  const scriptsDir = path.join(process.cwd(), "scripts");
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "lib") {
          continue;
        }
        walk(filePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
        continue;
      }
      const relativePath = path
        .relative(process.cwd(), filePath)
        .replaceAll("\\", "/");
      if (
        entry.name.endsWith(".test.mjs") ||
        entry.name.endsWith("-guards.mjs") ||
        entry.name.startsWith("check-") ||
        relativePath.includes("/test-fixtures/")
      ) {
        continue;
      }
      files.push({
        relativePath,
        content: fs.readFileSync(filePath, "utf8"),
      });
    }
  }

  walk(scriptsDir);
  return files;
}
