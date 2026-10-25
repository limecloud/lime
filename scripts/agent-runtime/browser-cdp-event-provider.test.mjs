import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBrowserCdpEventResponses } from "./browser-cdp-event-provider.mjs";
import { startBrowserCdpEventClient } from "./browser-runtime-electron-gate-b-cdp-events.mjs";

describe("CDP event fixture", () => {
  it("waits for the external consumer and preserves canonical tool results", async () => {
    const scenario = {
      cdp: {
        websocketUrl: "ws://127.0.0.1:4000/browser-runtime-gate-b-socket",
      },
    };
    const responses = createBrowserCdpEventResponses(scenario, {
      extractBrowserState: (body) => body,
      toolResultFromRequest: (body) => body,
    });
    const webSocketMessages = [];
    scenario.cdp.webSocketMessages = webSocketMessages;
    expect(scenario.cdp.events.webSocketMessages).toBe(webSocketMessages);
    const tab = {
      tabId: "tab-1",
      activeTurnId: "turn-1",
      controlOwner: "agent",
    };
    expect(responses[1]({ body: tab }).arguments.tabId).toBe(tab.tabId);
    expect(responses[2]({ body: tab }).name).toBe(
      "browser__addCdpEventListener",
    );
    const connection = {
      token: "private-test-token",
      pipePath: "private-test-pipe",
    };
    let ready = false;
    const enable = responses[3]({
      body: { status: "completed", data: connection },
    }).then((value) => {
      ready = true;
      return value;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(JSON.stringify(scenario)).not.toContain(connection.token);
    scenario.cdp.events.consumerReady();
    await expect(enable).resolves.toMatchObject({
      arguments: { tabId: tab.tabId, method: "Runtime.enable" },
    });
    expect(
      responses[4]({ body: { status: "completed", data: {} } }),
    ).toMatchObject({
      arguments: { method: "Runtime.evaluate" },
    });
    const enableNetwork = responses[5]({
      body: { status: "completed", data: { result: { value: 42 } } },
    });
    scenario.cdp.events.eventReceived();
    await expect(enableNetwork).resolves.toMatchObject({
      arguments: { tabId: tab.tabId, method: "Network.enable" },
    });
    expect(
      responses[6]({ body: { status: "completed", data: {} } }),
    ).toMatchObject({
      arguments: {
        tabId: tab.tabId,
        method: "Runtime.evaluate",
        commandParams: {
          expression: expect.stringContaining(scenario.cdp.websocketUrl),
        },
      },
    });
    const terminal = responses[7]({
      body: {
        status: "completed",
        data: { result: { value: "websocket-started" } },
      },
    });
    scenario.cdp.events.webSocketEventsReceived();
    await expect(terminal).resolves.toMatchObject({
      type: "text",
      content: "BROWSER_CDP_DONE_events",
    });
    expect(scenario.cdp.events.results.emit.success).toBe(true);
    expect(scenario.cdp.events.results.enableNetwork.success).toBe(true);
    expect(scenario.cdp.events.results.openWebSocket.success).toBe(true);
  });

  it("decodes separate-process notifications without exposing the credential in arguments", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "cdp-event-client-"),
    );
    let client;
    try {
      const clientModulePath = path.join(directory, "client.mjs");
      // Explicit client fixture; the native socket is covered by its integration tests.
      await fs.writeFile(
        clientModulePath,
        [
          "export async function connect(connection, callbacks) {",
          'if (connection.token !== "private-test-token") throw new Error("bad test token");',
          'callbacks.onCDPEvent({source: {tabId: "tab-1"}, method: "Runtime.consoleAPICalled", params: {args: [{value: "BROWSER_CDP_PERSISTENT_EVENT"}]}});',
          'callbacks.onCDPDetach({tabId: "tab-1"});',
          "return {closed: Promise.resolve()};",
          "}",
        ].join("\n"),
      );
      client = startBrowserCdpEventClient({
        clientModulePath,
        token: "private-test-token",
      });
      expect(client.child.spawnargs.join(" ")).not.toContain(
        "private-test-token",
      );
      await expect(client.exited).resolves.toEqual({ code: 0, signal: null });
      expect(client.errors).toEqual([]);
      expect(client.messages.map((value) => value.type)).toEqual([
        "event",
        "detach",
        "ready",
        "closed",
      ]);
    } finally {
      if (client?.child.exitCode === null) {
        client.child.kill("SIGTERM");
        await client.exited;
      }
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
