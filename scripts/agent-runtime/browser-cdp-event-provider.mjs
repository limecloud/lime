import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { completedBrowserCdpResult } from "./browser-cdp-session-provider.mjs";

function barrier() {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  return {
    release,
    wait: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error("CDP event consumer did not reach its barrier")),
          30_000,
        );
        pending.then(() => {
          clearTimeout(timer);
          resolve();
        });
      }),
  };
}

/** Scripted provider requests; the actual pipe capability comes only from the canonical tool. */
export function createBrowserCdpEventResponses(scenario, helpers) {
  const ready = barrier();
  const received = barrier();
  const webSocketReceived = barrier();
  const state = { results: {}, claimed: null };
  Object.defineProperties(state, {
    connection: { value: null, writable: true },
    webSocketMessages: { get: () => scenario.cdp.webSocketMessages },
    consumerReady: { value: ready.release },
    eventReceived: { value: received.release },
    webSocketEventsReceived: { value: webSocketReceived.release },
  });
  scenario.cdp.events = state;
  const result = (step, body) => {
    const value = completedBrowserCdpResult(
      helpers.toolResultFromRequest(body),
    );
    state.results[step] = { success: Boolean(value) };
    assert(
      value,
      `CDP event ${step} did not return a completed runtime result`,
    );
    return value;
  };
  const request = (step, tool, args = {}) => ({
    type: "tool_call",
    id: `cdp-events-${step}`,
    name: `browser__${tool}`,
    arguments: { tabId: state.claimed?.tabId, ...args },
  });
  return [
    {
      type: "tool_call",
      id: "cdp-events-tabs",
      name: "browser__openTabs",
      arguments: {},
    },
    ({ body }) => {
      const tab = helpers.extractBrowserState(
        helpers.toolResultFromRequest(body),
      );
      assert(
        tab?.tabId,
        "CDP event fixture did not receive a visible native tab",
      );
      return request("claim", "claimTab", {
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        pageRevision: tab.pageRevision,
      });
    },
    ({ body }) => {
      state.claimed = helpers.extractBrowserState(
        helpers.toolResultFromRequest(body),
      );
      assert(
        state.claimed?.activeTurnId && state.claimed.controlOwner === "agent",
        "CDP event fixture did not claim the current turn",
      );
      return request("subscribe", "addCdpEventListener");
    },
    async ({ body }) => {
      state.connection = result("subscribe", body).data;
      await ready.wait();
      return request("enable", "executeCdpCommand", {
        method: "Runtime.enable",
        commandParams: {},
      });
    },
    ({ body }) => {
      result("enable", body);
      return request("emit", "executeCdpCommand", {
        method: "Runtime.evaluate",
        commandParams: {
          expression: 'console.log("BROWSER_CDP_PERSISTENT_EVENT"); 42',
          returnByValue: true,
        },
      });
    },
    async ({ body }) => {
      state.results.emit = {
        success: result("emit", body).data.result?.value === 42,
      };
      await received.wait();
      return request("enableNetwork", "executeCdpCommand", {
        method: "Network.enable",
        commandParams: {},
      });
    },
    ({ body }) => {
      state.results.enableNetwork = {
        success: Boolean(result("enableNetwork", body)),
      };
      return request("openWebSocket", "executeCdpCommand", {
        method: "Runtime.evaluate",
        commandParams: {
          expression: `(() => { const socket = new WebSocket(${JSON.stringify(scenario.cdp.websocketUrl)}); window.__limeCdpWebSocket = socket; socket.addEventListener("open", () => socket.send("BROWSER_CDP_WS_REQUEST"), { once: true }); socket.addEventListener("message", () => socket.close(1000, "fixture complete"), { once: true }); return "websocket-started"; })()`,
          returnByValue: true,
        },
      });
    },
    async ({ body }) => {
      state.results.openWebSocket = {
        success:
          result("openWebSocket", body).data.result?.value ===
          "websocket-started",
      };
      await webSocketReceived.wait();
      return { type: "text", content: "BROWSER_CDP_DONE_events" };
    },
  ];
}
