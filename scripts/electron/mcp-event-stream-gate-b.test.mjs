import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MCP_EVENT_STREAM_NOTIFICATION_METHOD,
  MCP_EVENT_STREAM_REQUIRED_METHODS,
  MCP_EVENT_STREAM_START_METHOD,
  assertEvidence,
  summarizeMcpEventStreamEvidence,
} from "./mcp-event-stream-gate-b.mjs";
import { parseMcpConfigFixtureArgs } from "./lib/mcp-config-fixture-evidence.mjs";

function fixtureEvidence(transform = (value) => value) {
  const subscriptionId = "subscription-1";
  return summarizeMcpEventStreamEvidence(
    transform({
      traceRaw: JSON.stringify([
        {
          command: "app_server_handle_json_lines",
          transport: "electron-ipc",
          status: "success",
          args_preview: {
            request: {
              lines: [
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "thread/start",
                }),
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 2,
                  method: MCP_EVENT_STREAM_START_METHOD,
                }),
              ],
            },
          },
        },
        {
          command: "app_server_drain_events",
          transport: "electron-ipc",
          status: "success",
        },
      ]),
      subscriptionId,
      notifications: [
        {
          method: MCP_EVENT_STREAM_NOTIFICATION_METHOD,
          params: {
            subscriptionId,
            notification: { method: "notifications/events/active" },
          },
        },
        {
          method: MCP_EVENT_STREAM_NOTIFICATION_METHOD,
          params: {
            subscriptionId,
            notification: { method: "notifications/events/event" },
          },
        },
        {
          method: MCP_EVENT_STREAM_NOTIFICATION_METHOD,
          params: {
            subscriptionId,
            notification: { method: "notifications/events/active" },
          },
        },
        {
          method: MCP_EVENT_STREAM_NOTIFICATION_METHOD,
          params: {
            subscriptionId,
            notification: { method: "notifications/events/terminated" },
          },
        },
      ],
    }),
  );
}

describe("mcp-event-stream-gate-b", () => {
  it("accepts CLI options and current required methods", () => {
    expect(
      parseMcpConfigFixtureArgs(
        [
          "--prefix",
          "event-stream-fixture",
          "--timeout-ms",
          "90000",
          "--keep-temp",
        ],
        {
          defaults: {
            evidenceDir: "/tmp/event-stream",
            prefix: "event-stream-default",
            timeoutMs: 120_000,
            intervalMs: 250,
            keepTemp: false,
          },
        },
      ),
    ).toMatchObject({
      prefix: "event-stream-fixture",
      timeoutMs: 90_000,
      keepTemp: true,
    });
    expect(MCP_EVENT_STREAM_REQUIRED_METHODS).toEqual([
      "thread/start",
      MCP_EVENT_STREAM_START_METHOD,
    ]);
  });

  it("requires active, event, terminated and Electron bridge evidence", () => {
    const evidence = fixtureEvidence();
    expect(() => assertEvidence(evidence)).not.toThrow();
    expect(evidence.lifecycle).toMatchObject({
      activeCount: 2,
      eventCount: 1,
      terminatedCount: 1,
      repeatedActiveObserved: true,
      orderedLifecycle: true,
    });
  });

  it("keeps production mock and legacy paths out of the Gate B script", () => {
    const source = fs.readFileSync(
      path.resolve("scripts/electron/mcp-event-stream-gate-b.mjs"),
      "utf8",
    );
    expect(source).toContain("app_server_handle_json_lines");
    expect(source).toContain("app_server_drain_events");
    expect(source).toContain(MCP_EVENT_STREAM_START_METHOD);
    expect(source).not.toContain("invokeMockOnly");
    expect(source).not.toContain('APP_SERVER_BACKEND_MODE: "mock"');
    expect(source).not.toContain("agent_runtime_");
    expect(source).not.toContain("mcp-panel-tab");
    expect(source).not.toContain("mcp-event-stream-status");
    expect(source).toContain("No settings lifecycle UI");
  });
});

it("rejects unrelated subscriptions, wrong notification methods and out-of-order lifecycles", () => {
  for (const change of [
    (value) => ({ ...value, subscriptionId: "different-subscription" }),
    (value) => ({
      ...value,
      notifications: value.notifications.map((message) => ({
        ...message,
        method: "wrong/method",
      })),
    }),
    (value) => ({ ...value, notifications: value.notifications.toReversed() }),
  ]) {
    const evidence = fixtureEvidence(change);
    expect(evidence.ok).toBe(false);
    expect(() => assertEvidence(evidence)).toThrow();
  }
});
