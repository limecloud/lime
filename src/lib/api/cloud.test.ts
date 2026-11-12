import { expect, it, vi } from "vitest";
import { AppServerClient } from "./appServer";
import { requestCloud } from "./cloud";

it("uses typed cloud RPC without renderer credentials or HTTP", async () => {
  const client = new AppServerClient();
  const exchange = vi.spyOn(client, "exchange");
  const params = {
    path: "/catalog/skills",
    method: "GET" as const,
    language: "zh-CN",
  };
  const result = {
    status: 200,
    body: { items: [] },
    account: {
      type: "cloud",
      baseUrl: "https://cloud.test",
      issuer: "https://identity.test",
      applicationId: "lime",
      clientId: "native",
      environment: "sandbox",
      userId: "user",
      generation: "generation-one",
      resources: [],
      email: null,
      displayName: null,
    },
    operation: null,
  };
  exchange.mockResolvedValueOnce([{ id: 1, result }]);
  await expect(requestCloud(params, client)).resolves.toEqual(result);
  expect(exchange).toHaveBeenCalledWith(
    [{ id: 1, method: "cloud/request", params }],
    {},
  );
  exchange.mockRejectedValueOnce(new Error("not logged in"));
  await expect(requestCloud(params, client)).rejects.toThrow("not logged in");
});
