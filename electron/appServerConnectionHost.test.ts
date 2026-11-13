import { describe, expect, it, vi } from "vitest";
import type {
  AppServerConnection,
  JsonRpcMessage,
} from "@limecloud/app-server-client";
import { tryHandleConnectionAuthorize } from "./appServerConnectionHost";

function fixture() {
  const connection = {
    respondServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
  } as unknown as Pick<
    AppServerConnection,
    "respondServerRequest" | "rejectServerRequest"
  >;
  const params = {
    threadId: "thread",
    requestId: "irq_original",
    environment: "sandbox",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    approvalUrl:
      "https://console.test/connections/requests/irq_original?environment=sandbox",
  };
  const message: JsonRpcMessage = {
    id: "approval-original",
    method: "connection/authorize",
    params,
  };
  return { connection, params, message };
}

describe("file approval browser handoff", () => {
  it("opens the original request and reports opening without claiming approval", async () => {
    const { connection, params, message } = fixture();
    const open = vi.fn().mockResolvedValue(undefined);
    expect(
      await tryHandleConnectionAuthorize(connection, message, open, true),
    ).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(params.approvalUrl);
    expect(connection.respondServerRequest).toHaveBeenCalledExactlyOnceWith(
      message.id,
      { action: "opened" },
    );
  });
  it.each([
    "http://localhost/connections/requests/irq_original?environment=sandbox",
    "https://console.test/connections/requests/other?environment=sandbox",
    "https://console.test/connections/requests/irq_original?environment=production",
    "https://console.test/connections/requests/irq_original?environment=sandbox&next=https://else.test",
    "https://console.test/connections/requests/irq_original?environment=sandbox#done",
    "https://user:password@console.test/connections/requests/irq_original?environment=sandbox",
  ])("rejects a mismatched or unsafe URL %s", async (url) => {
    const { connection, params, message } = fixture();
    params.approvalUrl = url;
    const open = vi.fn();
    expect(
      await tryHandleConnectionAuthorize(connection, message, open, true),
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(connection.rejectServerRequest).toHaveBeenCalledOnce();
  });
  it("rejects expired requests and refuses a remote callback", async () => {
    const { connection, params, message } = fixture();
    params.expiresAt = "2000-01-01T00:00:00Z";
    const open = vi.fn();
    await tryHandleConnectionAuthorize(connection, message, open, true);
    expect(open).not.toHaveBeenCalled();
    expect(connection.rejectServerRequest).toHaveBeenCalledOnce();
    await tryHandleConnectionAuthorize(connection, message, open, false);
    expect(connection.respondServerRequest).toHaveBeenCalledExactlyOnceWith(
      message.id,
      { action: "unavailable" },
    );
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps browser failures private", async () => {
    const { connection, message } = fixture();
    const open = vi
      .fn()
      .mockRejectedValue(new Error("private browser failure"));
    await tryHandleConnectionAuthorize(connection, message, open, true);
    expect(connection.respondServerRequest).toHaveBeenCalledExactlyOnceWith(
      message.id,
      { action: "unavailable" },
    );
  });
});
