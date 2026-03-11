import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/lib/api/logs";
import {
  buildChannelLogRegex,
  filterChannelLogs,
} from "./channel-log-filter";

const MOCK_LOGS: LogEntry[] = [
  {
    timestamp: "2026-03-05 10:00:00.000",
    level: "info",
    message: "[TelegramGateway] account=default 启动成功",
  },
  {
    timestamp: "2026-03-05 10:00:01.000",
    level: "info",
    message: "[RPC] agent.run created runId=abc",
  },
  {
    timestamp: "2026-03-05 10:00:02.000",
    level: "info",
    message: "[FeishuGateway] account=default 启动成功",
  },
];

describe("channel-log-filter", () => {
  it("预置 telegram 过滤应命中 TelegramGateway", () => {
    const { regex, error } = buildChannelLogRegex("telegram", "");
    expect(error).toBeNull();
    const result = filterChannelLogs(MOCK_LOGS, regex);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("TelegramGateway");
  });

  it("预置 rpc 过滤应命中 RPC 与 agent.run", () => {
    const { regex, error } = buildChannelLogRegex("rpc", "");
    expect(error).toBeNull();
    const result = filterChannelLogs(MOCK_LOGS, regex);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("agent.run");
  });

  it("自定义正则非法时应返回错误并回退不过滤", () => {
    const { regex, error } = buildChannelLogRegex("custom", "[invalid");
    expect(regex).toBeNull();
    expect(error).toContain("正则表达式无效");
    const result = filterChannelLogs(MOCK_LOGS, regex);
    expect(result).toHaveLength(3);
  });

  it("all 模式应不过滤", () => {
    const { regex, error } = buildChannelLogRegex("all", "");
    expect(error).toBeNull();
    const result = filterChannelLogs(MOCK_LOGS, regex);
    expect(result).toHaveLength(3);
  });
});

