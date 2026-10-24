import { describe, expect, it, vi } from "vitest";
import type {
  DynamicToolCallResponse,
  JsonRpcRequest,
} from "@limecloud/app-server-client";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import { AppServerDynamicToolHost } from "./appServerDynamicToolHost";
import type { BrowserHistoryHost } from "./browserHistoryHost";
import { createHarness, mount } from "./browserTabHost.testHarness";

async function setup(
  access: "alwaysAsk" | "neverAsk" | "disabled" = "neverAsk",
) {
  const data = { entries: [], nextCursor: null, total: 0, revision: 1 };
  const invoke = vi.fn(async () => data);
  const native = createHarness({
    history: { invoke, forget: vi.fn() } as unknown as BrowserHistoryHost,
  });
  const settings = effectiveBrowserSettings(
    { iabHistoryApprovalMode: access },
    { default_origin_policy: { access: "deny" } },
  );
  native.host.setSettings(settings);
  await mount(native);
  const host = new AppServerDynamicToolHost(undefined, native.browserHost);
  host.observeClientResult(
    "thread/start",
    { thread: { id: "thread-1" } },
    { ownerWebContentsId: 41 },
  );
  const connection = {
    respondServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
  };
  const send = (overrides: Record<string, unknown> = {}) =>
    host.tryHandle(connection, {
      id: "history-request",
      method: "item/tool/call",
      params: {
        namespace: "browser",
        tool: "history",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "history-call",
        phase: "preflight",
        arguments: {},
        ...overrides,
      },
    });
  const response = () =>
    connection.respondServerRequest.mock.calls.at(-1)?.[1] as
      | DynamicToolCallResponse
      | undefined;
  return { host, connection, invoke, send, response, data };
}

describe("Browser history dynamic tool contract", () => {
  it("registers bounded read-only queries in the original frozen Browser namespace", async () => {
    const h = await setup();
    const prepared = h.host.prepareClientRequest({
      id: 1,
      method: "thread/start",
      params: {},
    } as JsonRpcRequest);
    const registry = (
      prepared.params as {
        dynamicTools: Array<{
          name: string;
          tools: Array<{ name: string; inputSchema: unknown }>;
        }>;
      }
    ).dynamicTools;
    expect(
      registry
        .find((entry) => entry.name === "browser")
        ?.tools.find((entry) => entry.name === "history"),
    ).toMatchObject({
      inputSchema: {
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 200 },
          query: { type: "string" },
          cursor: { type: "string" },
        },
      },
    });
    await h.send({ arguments: { query: "", limit: 200 } });
    expect(h.response()).toMatchObject({ success: true });
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("browser_history_list", {
      query: "",
      limit: 200,
      cursor: null,
    });
  });

  it.each([
    { query: 4 },
    { cursor: "" },
    { limit: 201 },
    { limit: 0 },
    { limit: 1.5 },
    { path: "/private/history" },
  ])(
    "rejects invalid wire arguments before the Browser owner: %j",
    async (args) => {
      const h = await setup();
      await h.send({ arguments: args });
      expect(h.connection.rejectServerRequest).toHaveBeenCalledTimes(1);
      expect(h.invoke).not.toHaveBeenCalled();
    },
  );

  it("returns no history in the approval phase, freezes the query and consumes one exact approval", async () => {
    const h = await setup("alwaysAsk");
    const args = { query: "private search", limit: 3 };
    await h.send({ arguments: args });
    const token = h.response()?.approval?.approvalToken;
    expect(token).toBeTruthy();
    expect(h.response()).toMatchObject({
      success: false,
      contentItems: [],
      approval: { actionKind: "history", riskClass: "history_read" },
    });
    expect(h.invoke).not.toHaveBeenCalled();
    await h.send({
      phase: "approvedExecute",
      approvalToken: token,
      arguments: { ...args, query: "different" },
    });
    expect(h.connection.rejectServerRequest).toHaveBeenCalledTimes(1);
    expect(h.invoke).not.toHaveBeenCalled();
    await h.send({
      phase: "approvedExecute",
      approvalToken: token,
      arguments: args,
    });
    expect(h.response()).toMatchObject({
      success: true,
      contentItems: [
        { type: "inputText", text: expect.stringContaining('"data":') },
      ],
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    await h.send({
      phase: "approvedExecute",
      approvalToken: token,
      arguments: args,
    });
    expect(h.connection.rejectServerRequest).toHaveBeenCalledTimes(2);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["thread", "disconnect"])(
    "revokes pending history approval on %s lifecycle",
    async (kind) => {
      const h = await setup("alwaysAsk");
      await h.send();
      const token = h.response()?.approval?.approvalToken;
      if (kind === "thread")
        h.host.observeServerMessage({
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "interrupted" },
          },
        });
      else h.host.connectionLost();
      await h.send({ phase: "approvedExecute", approvalToken: token });
      expect(h.connection.rejectServerRequest).toHaveBeenCalledTimes(1);
      expect(h.invoke).not.toHaveBeenCalled();
    },
  );

  it("keeps disabled access an explicit failed tool result without history contents", async () => {
    const h = await setup("disabled");
    await h.send();
    expect(h.response()).toMatchObject({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: expect.stringMatching(/history.*disabled/i),
        },
      ],
    });
    expect(h.response()?.approval).toBeUndefined();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
