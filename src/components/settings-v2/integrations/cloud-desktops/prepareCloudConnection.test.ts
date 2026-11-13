import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { prepareCloudConnection } from "./prepareCloudConnection";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/cloud", () => ({ requestCloudDesktop: request }));
const resource = {
  provider: "ecs" as const,
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
const receipt = (outcome: string) => ({
  data: {
    operationId: "original",
    request: { action: "prepareEcsConnection", resource },
    observedResource: resource,
    outcome,
    phase: outcome === "connectionReady" ? "complete" : "authorizing",
    requiresInspection: outcome !== "connectionReady",
  },
});

beforeEach(() => {
  request.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("keeps the same authorized intent while the server recovers an earlier operation", async () => {
  request
    .mockResolvedValueOnce(receipt("connectionPreparing"))
    .mockResolvedValueOnce(receipt("connectionReady"));
  const completed = prepareCloudConnection(resource, () => true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await completed).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0]);
  expect(request.mock.calls[0][0]).toMatchObject({
    resource,
    action: "prepareEcsConnection",
    confirmation: "prepareEcsConnection:cn-test:i-test",
  });
});

it("leaves custom networks with their existing owner", async () => {
  request.mockResolvedValue({ data: { outcome: "unmanagedNetwork" } });
  expect(await prepareCloudConnection(resource, () => true)).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

it("does not accept a ready receipt for a different computer", async () => {
  const other = receipt("connectionReady");
  other.data.observedResource = { ...resource, resourceId: "i-other" };
  request.mockResolvedValue(other);
  await expect(prepareCloudConnection(resource, () => true)).rejects.toThrow(
    "CLOUD_CONNECTION_SETUP_FAILED",
  );
});

it("accepts original rules only after the replacement computer was independently verified", async () => {
  const reused = receipt("connectionReady");
  reused.data.request.resource = { ...resource, resourceId: "i-released" };
  request.mockResolvedValue(reused);
  expect(await prepareCloudConnection(resource, () => true)).toBe(true);
  const unverified = { ...reused.data, observedResource: undefined };
  request.mockResolvedValue({ data: unverified });
  await expect(prepareCloudConnection(resource, () => true)).rejects.toThrow(
    "CLOUD_CONNECTION_SETUP_FAILED",
  );
});

it("stops observing after the owning screen is unmounted", async () => {
  let current = true;
  request.mockResolvedValue(receipt("connectionPreparing"));
  const completed = prepareCloudConnection(resource, () => current);
  await vi.advanceTimersByTimeAsync(0);
  current = false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(await completed).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

it("ends automatic observation and sends no later requests after its budget", async () => {
  request.mockResolvedValue(receipt("connectionPreparing"));
  const completed = prepareCloudConnection(resource, () => true).catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(600_000);
  expect(String(await completed)).toContain("CLOUD_CONNECTION_SETUP_FAILED");
  const calls = request.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(request).toHaveBeenCalledTimes(calls);
});
