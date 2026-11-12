import { cloudRequestMock, seedCloudAccount } from "@/test/cloudAccountFixture";
import { expect, it, vi } from "vitest";
import {
  getCloudAccount,
  logoutCloudAccount,
  CloudAccountChangedError,
} from "../cloudAccount";
import { requestCloud, CloudRequestError } from "./cloudClient";

it("rejects a late result after logout", async () => {
  await seedCloudAccount();
  const account = getCloudAccount()!.account;
  let finish!: (response: unknown) => void;
  cloudRequestMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = requestCloud({ path: "/market/items", method: "GET" });
  const rejected = expect(result).rejects.toBeInstanceOf(
    CloudAccountChangedError,
  );
  await logoutCloudAccount();
  finish({ status: 200, body: { items: ["old-user"] }, account });
  await rejected;
});
it("preserves an unknown operation reference and never calls renderer fetch", async () => {
  await seedCloudAccount();
  const fetch = vi.spyOn(globalThis, "fetch");
  const operation = {
    key: "original-operation",
    taskId: "original-task",
    recoveryPath: "/web/operations/original-operation",
    status: "outcome_unknown",
  };
  cloudRequestMock.mockResolvedValueOnce({
    status: 502,
    body: { error: "outcome_unknown" },
    operation,
    account: getCloudAccount()!.account,
  });
  const result = requestCloud({
    path: "/web/searches",
    method: "POST",
    body: { query: "research" },
    taskId: operation.taskId,
    operationKey: operation.key,
  });
  await expect(result).rejects.toBeInstanceOf(CloudRequestError);
  await expect(result).rejects.toMatchObject({
    response: { status: 502, operation },
  });
  expect(cloudRequestMock).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
