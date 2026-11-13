import { describe, expect, it, vi } from "vitest";
import type {
  AppServerConnection,
  JsonRpcMessage,
} from "@limecloud/app-server-client";
import { tryHandleAccountAuthorize } from "./appServerAccountHost";

function fixture() {
  const connection = {
    respondServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
  } as unknown as Pick<
    AppServerConnection,
    "respondServerRequest" | "rejectServerRequest"
  >;
  const params = {
    threadId: "thread-web",
    authorization: {
      id: "original-authorization",
      resource: "web",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    authUrl:
      "https://core.test/api/v1/client/auth/authorize?state=original&nonce=nonce&code_challenge=challenge&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Foauth%2Fcallback&resource=web",
  };
  const message: JsonRpcMessage = {
    id: "authorize-1",
    method: "account/authorize",
    params,
  };
  return { connection, params, message };
}

describe("native account browser handoff", () => {
  it("opens the original URL and reports only that the browser opened", async () => {
    const { connection, params, message } = fixture();
    const open = vi.fn().mockResolvedValue(undefined);
    expect(
      await tryHandleAccountAuthorize(connection, message, open, true),
    ).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(params.authUrl);
    expect(connection.respondServerRequest).toHaveBeenCalledExactlyOnceWith(
      message.id,
      { action: "opened" },
    );
  });

  it("opens default login without inferring another resource grant", async () => {
    const { connection, params, message } = fixture();
    params.authorization.resource = "default";
    params.authUrl = params.authUrl.replace("&resource=web", "");
    const open = vi.fn().mockResolvedValue(undefined);
    await tryHandleAccountAuthorize(connection, message, open, true);
    expect(open).toHaveBeenCalledExactlyOnceWith(params.authUrl);
    expect(connection.respondServerRequest).toHaveBeenCalledExactlyOnceWith(
      message.id,
      { action: "opened" },
    );
    expect(connection.rejectServerRequest).not.toHaveBeenCalled();
  });

  it("returns unavailable for a remote server without opening a browser", async () => {
    const { connection, message } = fixture();
    const open = vi.fn();
    await tryHandleAccountAuthorize(connection, message, open, false);
    expect(open).not.toHaveBeenCalled();
    expect(connection.respondServerRequest).toHaveBeenCalledWith(message.id, {
      action: "unavailable",
    });
  });

  it("does not leak browser errors or report authorization success", async () => {
    const { connection, message, params } = fixture();
    await tryHandleAccountAuthorize(
      connection,
      message,
      vi.fn().mockRejectedValue(new Error(params.authUrl)),
      true,
    );
    expect(connection.respondServerRequest).toHaveBeenCalledWith(message.id, {
      action: "unavailable",
    });
    expect(connection.rejectServerRequest).not.toHaveBeenCalled();
  });

  it.each([
    "file:///etc/hosts",
    "javascript:alert(1)",
    "http://core.test/api/v1/client/auth/authorize",
    "https://user:secret@core.test/api/v1/client/auth/authorize",
    "https://core.test/other",
    "https://core.test/api/v1/client/auth/authorize?state=only",
  ])("rejects an invalid handoff URL: %s", async (url) => {
    const { connection, params, message } = fixture();
    params.authUrl = url;
    const open = vi.fn();
    await tryHandleAccountAuthorize(connection, message, open, true);
    expect(open).not.toHaveBeenCalled();
    expect(connection.rejectServerRequest).toHaveBeenCalledWith(
      message.id,
      expect.objectContaining({ code: -32602 }),
    );
  });

  it("rejects expired or mismatched resource metadata", async () => {
    for (const mutation of ["expiry", "resource", "duplicate"] as const) {
      const { connection, params, message } = fixture();
      if (mutation === "expiry")
        params.authorization.expiresAt = "2000-01-01T00:00:00Z";
      if (mutation === "resource") params.authorization.resource = "market";
      if (mutation === "duplicate") params.authUrl += "&state=another";
      const open = vi.fn();
      await tryHandleAccountAuthorize(connection, message, open, true);
      expect(open).not.toHaveBeenCalled();
      expect(connection.rejectServerRequest).toHaveBeenCalledOnce();
    }
  });

  it("leaves other server requests to their owner", async () => {
    const { connection, message } = fixture();
    message.method = "currentTime/read";
    expect(
      await tryHandleAccountAuthorize(connection, message, vi.fn(), true),
    ).toBe(false);
    expect(connection.respondServerRequest).not.toHaveBeenCalled();
  });
});
