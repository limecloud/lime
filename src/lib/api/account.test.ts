import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "./appServer";
import { loginAccount, logoutAccount, readAccount } from "./account";

describe("shared account gateway", () => {
  it("uses native authorization without importing renderer credentials", async () => {
    const client = new AppServerClient();
    const exchange = vi.spyOn(client, "exchange");
    const params = {
      type: "cloud" as const,
      language: "zh-CN",
      resource: "market" as const,
    };
    const login = {
      authUrl: "https://identity.example.test/authorize?state=public",
      authorization: { id: "auth-one", resource: "market", status: "pending" },
    };
    exchange.mockResolvedValueOnce([{ id: 1, result: login }]);
    await expect(loginAccount(params, client)).resolves.toEqual(login);
    expect(exchange).toHaveBeenLastCalledWith(
      [{ id: 1, method: "account/login/start", params }],
      {},
    );
    exchange.mockResolvedValueOnce([
      { id: 2, result: { serviceUrl: null, account: null, authorizations: [] } },
    ]);
    await expect(readAccount({}, client)).resolves.toEqual({
      serviceUrl: null,
      account: null,
      authorizations: [],
    });
    expect(exchange).toHaveBeenLastCalledWith(
      [{ id: 2, method: "account/read", params: {} }],
      {},
    );
    exchange.mockResolvedValueOnce([{ id: 3, result: {} }]);
    await logoutAccount(client);
    expect(exchange).toHaveBeenLastCalledWith(
      [{ id: 3, method: "account/logout" }],
      {},
    );
    exchange.mockRejectedValueOnce(new Error("session rejected"));
    await expect(loginAccount(params, client)).rejects.toThrow(
      "session rejected",
    );
  });
});
